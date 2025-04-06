// index.js

// Express setup for uptime
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => {
  res.send('Bot is running!');
});
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Core bot setup
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const cron = require('node-cron');
const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

// Load daily messages module
const initDailyMessages = require('./daily-messages');

// Create the Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const CHANNEL_ID = process.env.CHANNEL_ID;

async function fetchLeetCodeContests() {
  try {
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
      headers: { 'Content-Type': 'application/json' }
    });
    const contests = response.data.data.allContests;
    const now = Math.floor(Date.now() / 1000);
    return contests.filter(contest => contest.startTime > now);
  } catch (error) {
    console.error('Error fetching LeetCode contests:', error);
    return [];
  }
}

async function fetchCodeChefContests() {
  try {
    const response = await axios.get('https://www.codechef.com/api/contests');
    const futureContests = response.data.future_contests || [];
    return futureContests.map(contest => ({
      title: contest.contest_name,
      startTime: new Date(contest.contest_start_date).getTime() / 1000,
      endTime: new Date(contest.contest_end_date).getTime() / 1000,
      duration: (new Date(contest.contest_end_date).getTime() - new Date(contest.contest_start_date).getTime()) / 60,
      url: `https://www.codechef.com/${contest.contest_code}`
    }));
  } catch (error) {
    console.error('Error fetching CodeChef contests:', error);
    return [];
  }
}

function formatContestTime(timestamp) {
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
}

async function sendContestsReminder(platform, contests) {
  const channel = client.channels.cache.get(CHANNEL_ID);
  if (!channel) return console.error('Channel not found!');

  if (contests.length === 0) {
    channel.send(`📭 No upcoming ${platform} contests found. Keep practicing! 🚀`);
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`🎉 Upcoming ${platform} Contests 🎉`)
    .setColor(platform === 'LeetCode' ? '#FFA500' : '#5B4638')
    .setTimestamp()
    .setFooter({ text: 'Contest Reminder Bot' });

  contests.forEach(contest => {
    embed.addFields({
      name: `🔥 ${contest.title}`,
      value:
        `📅 **Date & Time:** ${formatContestTime(contest.startTime)}\n` +
        `⏳ **Duration:** ${Math.round(contest.duration / 60)} hours\n` +
        (contest.url ? `🔗 [Join Now](${contest.url})\n` : '') +
        (contest.description ? `📝 ${contest.description}` : '')
    });
  });

  const msg = await channel.send({ content: `@everyone 💥 Here's your **${platform} Contest Reminder**! Stay sharp and good luck! 🍀`, embeds: [embed] });
  await msg.react('✅');
}

async function sendCombinedReminder() {
  const leetcodeContests = await fetchLeetCodeContests();
  const codechefContests = await fetchCodeChefContests();
  await sendContestsReminder('LeetCode', leetcodeContests);
  await sendContestsReminder('CodeChef', codechefContests);
}

async function sendLeetCodeReminder() {
  const leetcodeContests = await fetchLeetCodeContests();
  await sendContestsReminder('LeetCode', leetcodeContests);
}

async function sendCodeChefReminder() {
  const codechefContests = await fetchCodeChefContests();
  await sendContestsReminder('CodeChef', codechefContests);
}

async function scheduleTenMinuteWarnings() {
  const leetcodeContests = await fetchLeetCodeContests();
  const codechefContests = await fetchCodeChefContests();
  const allContests = [
    ...leetcodeContests.map(c => ({ ...c, platform: 'LeetCode' })),
    ...codechefContests.map(c => ({ ...c, platform: 'CodeChef' }))
  ];

  const now = Math.floor(Date.now() / 1000);

  allContests.forEach(contest => {
    const timeUntilStart = contest.startTime - now;
    const tenMinBefore = timeUntilStart - 600;

    if (tenMinBefore > 0) {
      setTimeout(async () => {
        const channel = client.channels.cache.get(CHANNEL_ID);
        if (!channel) return;

        const reminderEmbed = new EmbedBuilder()
          .setTitle(`🚨 10 Minutes Left for ${contest.platform} Contest!`)
          .setColor('#FF0000')
          .addFields({
            name: contest.title,
            value: `🎯 Starts at: ${formatContestTime(contest.startTime)}\n💥 Gear up and give your best! 🔥`
          });

        const msg = await channel.send({ content: '@everyone ⚠️ 10-Minute Countdown Begins!', embeds: [reminderEmbed] });
        await msg.react('✅');
      }, tenMinBefore * 1000);
    }
  });
}

// CRON SCHEDULES

// LeetCode on Saturdays at 6:00 PM IST (12:30 UTC)
cron.schedule('30 12 * * 6', sendLeetCodeReminder, { timezone: 'UTC' });

// CodeChef on Wednesdays at 6:00 PM IST (12:30 UTC)
cron.schedule('30 12 * * 3', sendCodeChefReminder, { timezone: 'UTC' });

// Combined reminder on Sundays at 3:30 PM IST (10:00 UTC)
cron.schedule('0 10 * * 0', sendCombinedReminder, { timezone: 'UTC' });

// Schedule ten-minute reminders every 30 mins
cron.schedule('*/30 * * * *', scheduleTenMinuteWarnings, { timezone: 'UTC' });

// Ready
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log('🕒 Reminders scheduled!');

  initDailyMessages(client);
});

// Login
client.login(process.env.DISCORD_TOKEN);
