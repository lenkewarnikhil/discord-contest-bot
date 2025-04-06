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
    GatewayIntentBits.GuildMessages
  ]
});

// Contest reminder configs
const CHANNEL_ID = process.env.CHANNEL_ID;

// LeetCode + CodeChef reminder logic
async function fetchLeetCodeContests() {
  try {
    const response = await axios.get('https://leetcode.com/graphql', {
      data: {
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
      },
      headers: {
        'Content-Type': 'application/json'
      }
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
  const options = {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  };
  return date.toLocaleString('en-IN', options) + ' IST';
}

async function sendContestReminders() {
  try {
    const channel = client.channels.cache.get(CHANNEL_ID);
    if (!channel) {
      console.error('Channel not found!');
      return;
    }

    const leetcodeContests = await fetchLeetCodeContests();
    const codechefContests = await fetchCodeChefContests();

    if (leetcodeContests.length === 0 && codechefContests.length === 0) {
      channel.send('No upcoming contests found on LeetCode or CodeChef.');
      return;
    }

    if (leetcodeContests.length > 0) {
      const leetcodeEmbed = new EmbedBuilder()
        .setTitle('Upcoming LeetCode Contests')
        .setColor('#FFBF00')
        .setTimestamp()
        .setFooter({ text: 'Contest Reminder Bot' });

      leetcodeContests.forEach(contest => {
        leetcodeEmbed.addFields({
          name: contest.title,
          value: `🕒 **Starts At:** ${formatContestTime(contest.startTime)}\n⏱️ **Duration:** ${contest.duration / 60} hours\n\n${contest.description || 'No description available'}`
        });
      });

      channel.send({ embeds: [leetcodeEmbed] });
    }

    if (codechefContests.length > 0) {
      const codechefEmbed = new EmbedBuilder()
        .setTitle('Upcoming CodeChef Contests')
        .setColor('#5B4638')
        .setTimestamp()
        .setFooter({ text: 'Contest Reminder Bot' });

      codechefContests.forEach(contest => {
        codechefEmbed.addFields({
          name: contest.title,
          value: `🕒 **Starts At:** ${formatContestTime(contest.startTime)}\n⏱️ **Duration:** ${Math.round(contest.duration / 60)} hours\n🔗 **Link:** [Contest Page](${contest.url})`
        });
      });

      channel.send({ embeds: [codechefEmbed] });
    }
  } catch (error) {
    console.error('Error sending contest reminders:', error);
  }
}

// Schedule reminders for Wednesdays & Saturdays at 6:00 PM IST (12:30 PM UTC)
cron.schedule('30 12 * * 3,6', sendContestReminders, {
  timezone: 'UTC'
});

// On ready
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log('Reminder bot is online and scheduled for Wednesdays and Saturdays at 6:00 PM IST');

  // 👇 Initialize daily messages module
  initDailyMessages(client);
});

// Login
client.login(process.env.DISCORD_TOKEN);
