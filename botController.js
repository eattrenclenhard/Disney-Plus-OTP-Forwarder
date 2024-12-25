require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { fork } = require('child_process');
const path = require('path');

const telegramConfig = {
    token: process.env.TELEGRAM_BOT_TOKEN,
    authorizedUsers: process.env.TELEGRAM_AUTHORIZED_USERS.split(',').map(id => id.trim()), // Parse multiple authorized user IDs
};

const bot = new TelegramBot(telegramConfig.token, { polling: true });
let mainProcess = null;

function startMainProcess() {
    if (!mainProcess) {
        mainProcess = fork(path.join(__dirname, 'mainProcess.js'));
        mainProcess.on('exit', () => {
            mainProcess = null;
        });
        console.log('Main process started');
    }
}

function stopMainProcess() {
    if (mainProcess) {
        mainProcess.kill();
        mainProcess = null;
        console.log('Main process stopped');
    }
}

function restartMainProcess() {
    stopMainProcess();
    startMainProcess();
}

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id.toString();
    if (telegramConfig.authorizedUsers.includes(chatId)) {
        const welcomeMessage = `
Welcome to the DisneyPlus OTP Forwarder Bot!
You can control the main process using the following commands:
/on - Start the main process
/off - Stop the main process
/restart - Restart the main process
/help - Show this help message
        `;
        bot.sendMessage(chatId, welcomeMessage);
    } else {
        bot.sendMessage(chatId, 'Unauthorized user');
    }
});

bot.onText(/\/on/, (msg) => {
    const chatId = msg.chat.id.toString();
    if (telegramConfig.authorizedUsers.includes(chatId)) {
        startMainProcess();
        bot.sendMessage(chatId, 'Main process started');
    } else {
        bot.sendMessage(chatId, 'Unauthorized user');
    }
});

bot.onText(/\/off/, (msg) => {
    const chatId = msg.chat.id.toString();
    if (telegramConfig.authorizedUsers.includes(chatId)) {
        stopMainProcess();
        bot.sendMessage(chatId, 'Main process stopped');
    } else {
        bot.sendMessage(chatId, 'Unauthorized user');
    }
});

bot.onText(/\/restart/, (msg) => {
    const chatId = msg.chat.id.toString();
    if (telegramConfig.authorizedUsers.includes(chatId)) {
        restartMainProcess();
        bot.sendMessage(chatId, 'Main process restarted');
    } else {
        bot.sendMessage(chatId, 'Unauthorized user');
    }
});

bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id.toString();
    const helpMessage = `
Available commands:
/on - Start the main process
/off - Stop the main process
/restart - Restart the main process
/help - Show this help message
    `;
    bot.sendMessage(chatId, helpMessage);
});

// Start the main process initially
startMainProcess();