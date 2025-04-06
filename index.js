// index.js

// Express setup for uptime
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// Enhanced error handling for Express
app.use((err, req, res, next) => {
  console.error('Express error:', err.stack);
  res.status(500).send('Something broke!');
});

app.get('/', (req, res) => {
  res.send('Bot is running!');
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    lastScheduledCheck: global.lastScheduledCheck || 'No checks yet'
  });
});

const server = app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Graceful shutdown
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function shutdown() {
  console.log('Received shutdown signal. Closing server...');
  server.close(() => {
    console.log('Server closed. Exiting process.');
    process.exit(0);
  });
  
  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('Forcing exit after timeout');
    process.exit(1);
  }, 10000);
}

// Core bot setup
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const cron = require('node-cron');
const axios = require('axios');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
dotenv.config();

// Validate essential environment variables
const requiredEnvVars = ['DISCORD_TOKEN', 'CHANNEL_ID'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingEnvVars.length > 0) {
  console.error(`Error: Missing required environment variables: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

// Load daily messages module
let initDailyMessages;
try {
  initDailyMessages = require('./daily-messages');
} catch (err) {
  console.error('Error loading daily-messages module:', err);
  // Create a fallback function if the module is missing
  initDailyMessages = (client) => {
    console.warn('Daily messages module not found or failed to load. This feature will be disabled.');
    return null;
  };
}

// Constants
const CHANNEL_ID = process.env.CHANNEL_ID;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const BACKUP_CHANNEL_ID = process.env.BACKUP_CHANNEL_ID || null;
const DISCORD_ADMIN_ID = process.env.DISCORD_ADMIN_ID || null;
const RETRY_DELAY = 60000; // 1 minute
const MAX_RETRIES = 3;
const LOG_FILE = process.env.LOG_FILE || './bot-log.txt';

// Setup logging
function logToFile(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp}: ${message}\n`;
  
  try {
    fs.appendFileSync(LOG_FILE, logMessage);
  } catch (err) {
    console.error('Failed to write to log file:', err);
  }
  
  console.log(logMessage.trim());
}

// Create the Discord client with reconnection settings
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  rest: {
    retries: 5,
    timeout: 15000
  }
});

// API fetch functions with retries
async function fetchWithRetry(fetchFunc, platform, retries = 0) {
  try {
    return await fetchFunc();
  } catch (error) {
    logToFile(`Error fetching ${platform} contests (attempt ${retries + 1}/${MAX_RETRIES}): ${error.message}`);
    
    if (retries < MAX_RETRIES) {
      logToFile(`Retrying ${platform} fetch in ${RETRY_DELAY / 1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return fetchWithRetry(fetchFunc, platform, retries + 1);
    } else {
      logToFile(`All ${platform} fetch attempts failed. Giving up.`);
      return [];
    }
  }
}

async function fetchLeetCodeContests() {
  return fetchWithRetry(async () => {
    const response = await axios.post('https://leetcode.com/graphql', {
      query: `
        query {
          allContests {
            title
            startTime
            duration
            description
          }
        }
      `
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });
    
    if (!response.data || !response.data.data || !response.data.data.allContests) {
      throw new Error('Invalid response structure from LeetCode API');
    }
    
    const contests = response.data.data.allContests;
    const now = Math.floor(Date.now() / 1000);
    return contests.filter(contest => contest.startTime > now);
  }, 'LeetCode');
}

async function fetchCodeChefContests() {
  return fetchWithRetry(async () => {
    const response = await axios.get('https://www.codechef.com/api/contests', {
      timeout: 10000
    });
    
    if (!response.data || !response.data.future_contests) {
      throw new Error('Invalid response structure from CodeChef API');
    }
    
    const futureContests = response.data.future_contests || [];
    return futureContests.map(contest => ({
      title: contest.contest_name || 'Unnamed Contest',
      startTime: new Date(contest.contest_start_date).getTime() / 1000,
      endTime: new Date(contest.contest_end_date).getTime() / 1000,
      duration: (new Date(contest.contest_end_date).getTime() - new Date(contest.contest_start_date).getTime()) / 60,
      url: `https://www.codechef.com/${contest.contest_code}`
    }));
  }, 'CodeChef');
}

function formatContestTime(timestamp) {
  try {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }) + ' IST';
  } catch (error) {
    logToFile(`Error formatting contest time: ${error.message}`);
    return 'Invalid date';
  }
}

// Discord message sending functions with fallback
async function sendDiscordMessage(channelId, content) {
  try {
    const channel = client.channels.cache.get(channelId);
    if (!channel) {
      throw new Error(`Channel not found: ${channelId}`);
    }
    return await channel.send(content);
  } catch (error) {
    logToFile(`Error sending Discord message: ${error.message}`);
    
    // Try the backup channel if available
    if (BACKUP_CHANNEL_ID && channelId !== BACKUP_CHANNEL_ID) {
      logToFile(`Attempting to send to backup channel: ${BACKUP_CHANNEL_ID}`);
      try {
        const backupChannel = client.channels.cache.get(BACKUP_CHANNEL_ID);
        if (backupChannel) {
          return await backupChannel.send({
            content: `⚠️ Failed to send to main channel. Original message: ${content.content ? content.content : 'No content'}`
          });
        }
      } catch (backupError) {
        logToFile(`Failed to send to backup channel: ${backupError.message}`);
      }
    }
    
    // Notify admin if available
    if (DISCORD_ADMIN_ID) {
      try {
        const admin = await client.users.fetch(DISCORD_ADMIN_ID);
        await admin.send(`⚠️ Failed to send reminder to channel ${channelId}: ${error.message}`);
      } catch (adminError) {
        logToFile(`Failed to notify admin: ${adminError.message}`);
      }
    }
    
    return null;
  }
}

async function sendContestsReminder(platform, contests) {
  logToFile(`Sending ${platform} contest reminder, found ${contests.length} contests`);
  
  try {
    if (contests.length === 0) {
      await sendDiscordMessage(CHANNEL_ID, `📭 No upcoming ${platform} contests found. Keep practicing! 🚀`);
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`🎉 Upcoming ${platform} Contests 🎉`)
      .setColor(platform === 'LeetCode' ? '#FFA500' : '#5B4638')
      .setTimestamp()
      .setFooter({ text: 'Contest Reminder Bot' });

    contests.forEach(contest => {
      if (!contest.title || !contest.startTime) {
        logToFile(`Warning: Incomplete contest data for ${platform}: ${JSON.stringify(contest)}`);
        return;
      }
      
      embed.addFields({
        name: `🔥 ${contest.title}`,
        value:
          `📅 **Date & Time:** ${formatContestTime(contest.startTime)}\n` +
          `⏳ **Duration:** ${Math.round((contest.duration || 0) / 60)} hours\n` +
          (contest.url ? `🔗 [Join Now](${contest.url})\n` : '') +
          (contest.description ? `📝 ${contest.description.substring(0, 1000)}` : '')
      });
    });

    const msg = await sendDiscordMessage(CHANNEL_ID, { 
      content: `@everyone 💥 Here's your **${platform} Contest Reminder**! Stay sharp and good luck! 🍀`, 
      embeds: [embed] 
    });
    
    if (msg) {
      try {
        await msg.react('✅');
      } catch (reactError) {
        logToFile(`Failed to add reaction to message: ${reactError.message}`);
      }
    }
    
    return true;
  } catch (error) {
    logToFile(`Error in sendContestsReminder for ${platform}: ${error.message}`);
    return false;
  }
}

async function sendCombinedReminder() {
  logToFile('Starting combined reminder function at: ' + new Date().toISOString());
  global.lastScheduledCheck = new Date().toISOString();
  
  try {
    const leetcodeContests = await fetchLeetCodeContests();
    logToFile(`Fetched ${leetcodeContests.length} LeetCode contests`);
    
    const codechefContests = await fetchCodeChefContests();
    logToFile(`Fetched ${codechefContests.length} CodeChef contests`);
    
    const lcResult = await sendContestsReminder('LeetCode', leetcodeContests);
    const ccResult = await sendContestsReminder('CodeChef', codechefContests);
    
    logToFile(`Combined reminder sent successfully. LeetCode: ${lcResult}, CodeChef: ${ccResult}`);
    return true;
  } catch (error) {
    logToFile(`Error in sendCombinedReminder: ${error.message}`);
    logToFile(error.stack);
    
    // Notify admin about the failure
    if (DISCORD_ADMIN_ID) {
      try {
        const admin = await client.users.fetch(DISCORD_ADMIN_ID);
        await admin.send(`❌ Combined reminder failed: ${error.message}`);
      } catch (adminError) {
        logToFile(`Failed to notify admin about combined reminder failure: ${adminError.message}`);
      }
    }
    
    return false;
  }
}

async function sendLeetCodeReminder() {
  logToFile('Starting LeetCode reminder function at: ' + new Date().toISOString());
  global.lastScheduledCheck = new Date().toISOString();
  
  try {
    const leetcodeContests = await fetchLeetCodeContests();
    logToFile(`Fetched ${leetcodeContests.length} LeetCode contests`);
    
    const result = await sendContestsReminder('LeetCode', leetcodeContests);
    logToFile(`LeetCode reminder sent successfully: ${result}`);
    return result;
  } catch (error) {
    logToFile(`Error in sendLeetCodeReminder: ${error.message}`);
    return false;
  }
}

async function sendCodeChefReminder() {
  logToFile('Starting CodeChef reminder function at: ' + new Date().toISOString());
  global.lastScheduledCheck = new Date().toISOString();
  
  try {
    const codechefContests = await fetchCodeChefContests();
    logToFile(`Fetched ${codechefContests.length} CodeChef contests`);
    
    const result = await sendContestsReminder('CodeChef', codechefContests);
    logToFile(`CodeChef reminder sent successfully: ${result}`);
    return result;
  } catch (error) {
    logToFile(`Error in sendCodeChefReminder: ${error.message}`);
    return false;
  }
}

async function scheduleTenMinuteWarnings() {
  logToFile('Scheduling ten-minute warnings at: ' + new Date().toISOString());
  global.lastScheduledCheck = new Date().toISOString();
  
  try {
    const leetcodeContests = await fetchLeetCodeContests();
    const codechefContests = await fetchCodeChefContests();
    
    const allContests = [
      ...leetcodeContests.map(c => ({ ...c, platform: 'LeetCode' })),
      ...codechefContests.map(c => ({ ...c, platform: 'CodeChef' }))
    ];

    const now = Math.floor(Date.now() / 1000);
    let warningsScheduled = 0;

    allContests.forEach(contest => {
      if (!contest.startTime) {
        logToFile(`Warning: Contest missing startTime: ${JSON.stringify(contest)}`);
        return;
      }
      
      const timeUntilStart = contest.startTime - now;
      const tenMinBefore = timeUntilStart - 600; // 10 minutes in seconds

      if (tenMinBefore > 0 && tenMinBefore < 1800) { // Only schedule if within 30 minutes
        warningsScheduled++;
        
        setTimeout(async () => {
          try {
            logToFile(`Sending 10-minute warning for ${contest.platform} contest: ${contest.title}`);
            
            const reminderEmbed = new EmbedBuilder()
              .setTitle(`🚨 10 Minutes Left for ${contest.platform} Contest!`)
              .setColor('#FF0000')
              .addFields({
                name: contest.title,
                value: `🎯 Starts at: ${formatContestTime(contest.startTime)}\n💥 Gear up and give your best! 🔥`
              });

            const msg = await sendDiscordMessage(CHANNEL_ID, { 
              content: '@everyone ⚠️ 10-Minute Countdown Begins!', 
              embeds: [reminderEmbed] 
            });
            
            if (msg) {
              try {
                await msg.react('✅');
              } catch (reactError) {
                logToFile(`Failed to add reaction to 10-min warning: ${reactError.message}`);
              }
            }
          } catch (error) {
            logToFile(`Error sending 10-minute warning: ${error.message}`);
          }
        }, tenMinBefore * 1000);
      }
    });

    logToFile(`Scheduled ${warningsScheduled} ten-minute warnings`);
    return true;
  } catch (error) {
    logToFile(`Error scheduling ten-minute warnings: ${error.message}`);
    return false;
  }
}

// Manual trigger command
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  
  if (message.content.startsWith('!contest')) {
    const args = message.content.split(' ');
    
    if (args[1] === 'check') {
      await message.reply('Running contest check...');
      await sendCombinedReminder();
    } else if (args[1] === 'leetcode') {
      await message.reply('Checking LeetCode contests...');
      await sendLeetCodeReminder();
    } else if (args[1] === 'codechef') {
      await message.reply('Checking CodeChef contests...');
      await sendCodeChefReminder();
    } else if (args[1] === 'warn') {
      await message.reply('Scheduling 10-minute warnings...');
      await scheduleTenMinuteWarnings();
    } else if (args[1] === 'status') {
      await message.reply(`Bot is running. Last check: ${global.lastScheduledCheck || 'No checks yet'}`);
    } else {
      await message.reply('Available commands: `!contest check`, `!contest leetcode`, `!contest codechef`, `!contest warn`, `!contest status`');
    }
  }
});

// CRON SCHEDULES

// Validate cron expressions
function validateCronExpression(expr, name) {
  try {
    // Test if expression is valid
    cron.validate(expr);
    return true;
  } catch (error) {
    logToFile(`Invalid cron expression for ${name}: ${expr}`);
    logToFile(`Error: ${error.message}`);
    return false;
  }
}

// Define cron jobs with validation
const cronJobs = [
  {
    name: 'LeetCode Saturday',
    expression: '30 12 * * 6',
    handler: sendLeetCodeReminder,
    description: 'LeetCode on Saturdays at 6:00 PM IST (12:30 UTC)'
  },
  {
    name: 'CodeChef Wednesday',
    expression: '30 12 * * 3',
    handler: sendCodeChefReminder,
    description: 'CodeChef on Wednesdays at 6:00 PM IST (12:30 UTC)'
  },
  {
    name: 'Combined Sunday',
    expression: '0 10 * * 0',
    handler: sendCombinedReminder,
    description: 'Combined reminder on Sundays at 3:30 PM IST (10:00 UTC)'
  },
  {
    name: 'Ten-minute warnings',
    expression: '*/30 * * * *',
    handler: scheduleTenMinuteWarnings,
    description: 'Schedule ten-minute reminders every 30 mins'
  }
];

// Schedule validated cron jobs
cronJobs.forEach(job => {
  if (validateCronExpression(job.expression, job.name)) {
    cron.schedule(job.expression, async () => {
      logToFile(`Running scheduled job: ${job.name} - ${job.description}`);
      try {
        await job.handler();
      } catch (error) {
        logToFile(`Error in cron job ${job.name}: ${error.message}`);
      }
    }, { timezone: 'UTC' });
    
    logToFile(`Scheduled: ${job.name} - ${job.description}`);
  } else {
    logToFile(`Failed to schedule job: ${job.name}`);
  }
});

// Handle Discord connection
client.once('ready', () => {
  logToFile(`✅ Logged in as ${client.user.tag}`);
  logToFile('🕒 Reminders scheduled!');
  
  // Initialize the bot's status
  client.user.setActivity('for contests...', { type: 'WATCHING' });
  
  // Check channel access
  const channel = client.channels.cache.get(CHANNEL_ID);
  if (!channel) {
    logToFile(`⚠️ WARNING: Cannot find channel with ID ${CHANNEL_ID}`);
  } else {
    logToFile(`✅ Successfully connected to channel: ${channel.name}`);
  }
  
  // Initialize daily messages
  try {
    initDailyMessages(client);
    logToFile('✅ Daily messages initialized');
  } catch (error) {
    logToFile(`⚠️ Error initializing daily messages: ${error.message}`);
  }
});

// Error handling for Discord
client.on('error', error => {
  logToFile(`Discord client error: ${error.message}`);
});

client.on('shardError', error => {
  logToFile(`Discord websocket error: ${error.message}`);
});

// Reconnection handling
client.on('disconnect', () => {
  logToFile('Bot disconnected from Discord!');
});

client.on('reconnecting', () => {
  logToFile('Bot is reconnecting to Discord...');
});

// Handle process-level errors
process.on('uncaughtException', (error) => {
  logToFile(`Uncaught Exception: ${error.message}`);
  logToFile(error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  logToFile('Unhandled Rejection at:', promise);
  logToFile(`Reason: ${reason}`);
});

// Login with retry
async function loginWithRetry(retries = 0) {
  try {
    logToFile('Attempting to log in to Discord...');
    await client.login(DISCORD_TOKEN);
  } catch (error) {
    logToFile(`Login failed (attempt ${retries + 1}/${MAX_RETRIES}): ${error.message}`);
    
    if (retries < MAX_RETRIES) {
      const delay = RETRY_DELAY * (retries + 1);
      logToFile(`Retrying login in ${delay / 1000} seconds...`);
      setTimeout(() => loginWithRetry(retries + 1), delay);
    } else {
      logToFile('All login attempts failed. Exiting...');
      process.exit(1);
    }
  }
}

// Start the bot
loginWithRetry();