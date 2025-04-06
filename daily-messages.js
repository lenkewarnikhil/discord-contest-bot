const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const cron = require('node-cron');

try {
  require('dotenv').config();
} catch (error) {
  console.log('Environment already configured');
}

let client;

module.exports = function initDailyMessages(existingClient) {
  if (existingClient) {
    client = existingClient;
    console.log('Using existing Discord client for daily messages');
    setupDailyMessages();
  } else {
    client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers
      ]
    });

    client.once('ready', () => {
      console.log(`Logged in as ${client.user.tag}!`);
      console.log(`Daily messages will be sent to channel ID: ${process.env.DAILY_MESSAGE_CHANNEL_ID}`);
      setupDailyMessages();
    });

    client.login(process.env.BOT_TOKEN);
  }

  client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const user = interaction.user.username;
    const responseMap = {
      'poll_1': '1 Question',
      'poll_2': '2 Questions',
      'poll_3': '3 Questions',
      'poll_4': '4+ Questions'
    };

    const response = responseMap[interaction.customId];
    if (response) {
      await interaction.reply({
        content: `Thanks ${user}! You selected: **${response}** ✅`,
        ephemeral: true
      });
      console.log(`${user} responded with: ${response}`);
    }
  });
};

const MORNING_CHANNEL_ID = process.env.DAILY_MESSAGE_CHANNEL_ID;
const CRON_MORNING = '15 9 * * *';
const CRON_NIGHT = '0 21 * * *';

const motivationalQuotes = [
  "The only way to do great work is to love what you do. - Steve Jobs",
  "Success is not final, failure is not fatal: It is the courage to continue that counts. - Winston Churchill",
  "Your time is limited, don't waste it living someone else's life. - Steve Jobs",
  "Believe you can and you're halfway there. - Theodore Roosevelt",
  "It does not matter how slowly you go as long as you do not stop. - Confucius",
  "Everything you've ever wanted is on the other side of fear. - George Addair",
  "Success is walking from failure to failure with no loss of enthusiasm. - Winston Churchill",
  "The only limit to our realization of tomorrow will be our doubts of today. - Franklin D. Roosevelt",
  "The way to get started is to quit talking and begin doing. - Walt Disney",
  "If you are working on something that you really care about, you don't have to be pushed. The vision pulls you. - Steve Jobs"
];

function setupDailyMessages() {
  cron.schedule(CRON_MORNING, () => {
    sendGoodMorningMessage();
  }, {
    timezone: "Asia/Kolkata"
  });

  cron.schedule(CRON_NIGHT, () => {
    sendGoodNightMessage();
  }, {
    timezone: "Asia/Kolkata"
  });

  // 2nd Year Reminder at 10:50 AM
  cron.schedule('50 10 * * *', () => {
    sendReminderMessage("2nd Year");
  }, {
    timezone: "Asia/Kolkata"
  });

  // 3rd Year Reminder at 12:30 PM
  cron.schedule('30 12 * * *', () => {
    sendReminderMessage("3rd Year");
  }, {
    timezone: "Asia/Kolkata"
  });
}

async function sendGoodMorningMessage() {
  try {
    const channel = await client.channels.fetch(MORNING_CHANNEL_ID);
    if (!channel) return console.error("Channel not found");

    const randomQuote = motivationalQuotes[Math.floor(Math.random() * motivationalQuotes.length)];

    await channel.send({
      content: `@everyone\n\n**Good Morning Everyone!** ☀️\n\nHere's your daily dose of motivation:\n\n> ${randomQuote}\n\nLet's make today count!`
    });

    console.log('Good morning message sent successfully');
  } catch (error) {
    console.error('Error sending good morning message:', error);
  }
}

async function sendGoodNightMessage() {
  try {
    const channel = await client.channels.fetch(MORNING_CHANNEL_ID);
    if (!channel) return console.error("Channel not found");

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('poll_1')
          .setLabel('1 Question')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('poll_2')
          .setLabel('2 Questions')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('poll_3')
          .setLabel('3 Questions')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('poll_4')
          .setLabel('4+ Questions')
          .setStyle(ButtonStyle.Primary)
      );

    await channel.send({
      content: `@everyone\n\n**Good Night Everyone!** 🌙\n\nBefore you sign off for the day, please let us know how many questions you solved today:`,
      components: [row]
    });

    console.log('Good night message with poll sent successfully');
  } catch (error) {
    console.error('Error sending good night message:', error);
  }
}

async function sendReminderMessage(year) {
  try {
    const channel = await client.channels.fetch(MORNING_CHANNEL_ID);
    if (!channel) return console.error("Channel not found");

    const sentMessage = await channel.send({
      content: `@everyone\n\n📚 **Reminder for ${year} students**\n\nPlease make sure to **revise today's notes** after reaching home! Consistency is key 🔑\n\n✅ Please react to this message with a ✅ once you're done reading this message.`
    });

    // React with a check mark
    await sentMessage.react('✅');

    console.log(`Reminder message sent and reaction added for ${year} students`);
  } catch (error) {
    console.error(`Error sending reminder message for ${year}:`, error);
  }
}

