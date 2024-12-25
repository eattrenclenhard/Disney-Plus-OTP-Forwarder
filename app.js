require('dotenv').config();

const Imap = require('node-imap');
const TelegramBot = require('node-telegram-bot-api');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const simpleParser = require('mailparser').simpleParser; // Import mailparser
const moment = require('moment-timezone');

const emailConfig = {
    user: process.env.EMAIL_USER,
    password: process.env.EMAIL_PASSWORD,
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT, 10),
    tls: process.env.EMAIL_TLS === 'true',
};

const telegramConfig = {
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatIds: process.env.TELEGRAM_CHAT_ID.split(',').map(id => id.trim()), // Parse multiple chat IDs
};

const pollingInterval = parseInt(process.env.POLLING_INTERVAL, 10) || 300000; // Default to 5 minutes if not set
const forwardHistoricalEmail = process.env.FORWARD_HISTORICAL_EMAIL === 'true'; // Default to false if not set
const markForwardedSeen = process.env.MARK_FORWARDED_SEEN === 'true'; // Default to false if not set
const deployTimeOffset = parseInt(process.env.DEPLOY_TIME_OFFSET, 0) || 0

// Validate required environment variables
if (!telegramConfig.token) {
    throw new Error('TELEGRAM_BOT_TOKEN is not set in .env file');
}

if (!telegramConfig.chatIds || telegramConfig.chatIds.length === 0) {
    throw new Error('TELEGRAM_CHAT_ID is not set or invalid in .env file');
}

const imap = new Imap(emailConfig);
const bot = new TelegramBot(telegramConfig.token);

// Capture the current date and time when the script starts
const deployTime = moment().utc().add(deployTimeOffset, 'minutes').toDate();
// const deployTime = moment('2025-01-01T12:00:00Z').toDate(); 

function openInbox(cb) {
    imap.openBox('INBOX', false, cb); // set to true for read-only mode
}

function extractPasscodeFromHtml(html) {
    // Load the HTML into cheerio
    const $ = cheerio.load(html);

    // Remove all script and style elements
    $('script, style').remove();

    // Get the text content
    const textContent = $('body').text();

    // Extract the passcode using a regular expression
    const passcodeMatch = textContent.match(/\d{6}/);
    if (passcodeMatch && passcodeMatch[0]) {
        console.log('Passcode found:', passcodeMatch[0]);
        return passcodeMatch[0];
    }
    console.log('No passcode found');
    return '';
}

function searchAndProcessUnseenMessages() {
    // Construct search criteria
    let searchCriteria = [];

    if (!forwardHistoricalEmail) {
        searchCriteria.push('UNSEEN');
        searchCriteria.push(['SINCE', deployTime]);
    } else {
        searchCriteria.push('UNSEEN');
    }

    searchCriteria.push(['OR',
        ['FROM', '<disneyplus@mail2.disneyplus.com>'],
        ['FROM', '<disneyplus@mail.disneyplus.com>']
    ]);
    searchCriteria.push(['SUBJECT', 'Your one-time passcode for Disney+']);

    const fetchOptions = { bodies: '', struct: true };

    console.log('Search Criteria:', searchCriteria); // Log the search criteria
    // console.log('Deploy Time (UTC):', deployTime.toISOString()); // Log the deploy time in UTC

    imap.search(searchCriteria, (err, results) => {
        if (err) {
            console.error('Error searching for emails:', err);
            return;
        }

        console.log('Search Results:', results); // Log the search results

        if (results.length === 0) {
            console.log('No new unseen messages found.');
            return;
        }

        // Process each email sequentially
        for (let index = 0; index < results.length; index++) {
            // Process each email sequentially
            processEmailsSequentially(results, index);
        }
        // processEmailsSequentially(results, 0);
    });
}

function processEmailsSequentially(results, index) {
    if (index >= results.length) {
        console.log('Done processing all messages!');
        return;
    }

    const f = imap.fetch([results[index]], { bodies: '', struct: true });

    f.on('message', (msg, seqno) => {
        let emailDetails = {};

        msg.on('body', (stream, info) => {
            simpleParser(stream, (err, parsed) => {
                if (err) {
                    console.error('Error parsing email:', err);
                    // Process the next email even if there's an error
                    processEmailsSequentially(results, index + 1);
                    return;
                }

                // Store parsed email details
                emailDetails.parsed = parsed;

                // Use the text or html content from the parsed email
                let body = '';
                if (parsed.html) {
                    body = parsed.html;
                } else if (parsed.text) {
                    body = parsed.text;
                }

                // Extract the passcode using cheerio and regex
                const passcode = extractPasscodeFromHtml(body);
                console.log('Extracted Passcode:', passcode); // Debugging line

                // Create the message content
                const offset = moment().format('Z');
                console.log(`Timezone: ${offset}`);
                let messageContent = `Date: ${parsed.date.toLocaleString()}\n`;
                if (passcode) {
                    messageContent += `Passcode: \`${passcode}\``;
                } else {
                    messageContent += 'Passcode not found in the email.';
                }

                // Send the message to all Telegram chat IDs
                telegramConfig.chatIds.forEach(chatId => {
                    bot.sendMessage(chatId, messageContent, { parse_mode: 'MarkdownV2' })
                        .then(() => {
                            console.log('Message sent to Telegram chat ID:', chatId);
                            if (markForwardedSeen) {
                                console.log('marking email as seen...')
                                // Mark the email as seen
                                markEmailAsSeen(results[index], () => {
                                    // Process the next email
                                    processEmailsSequentially(results, index + 1);
                                });
                            }
                        })
                        .catch((err) => {
                            console.error('Error sending message to Telegram chat ID:', chatId, err);
                        });
                });
            });
        });

        msg.once('attributes', (attrs) => {
            emailDetails.attributes = attrs;
            // console.log('Email Attributes:', attrs); // Log email attributes
        });

        msg.once('end', () => {
            console.log('Done fetching message:', results[index]);
            console.log('Email Details:', emailDetails); // Log detailed email information
        });
    });

    f.once('error', (err) => {
        console.error('Fetch error:', err);
        // Process the next email even if there's an error
        processEmailsSequentially(results, index + 1);
    });

    f.once('end', () => {
        console.log('Finished fetching all messages');
    });
}

function markEmailAsSeen(uid, callback) {
    imap.addFlags(uid, '\\Seen', (err) => {
        if (err) {
            console.error(`Error marking email ${uid} as seen:`, err);
        } else {
            console.log(`Email ${uid} marked as seen`);
        }
        callback();
    });
}

imap.once('ready', () => {
    openInbox((err, box) => {
        if (err) {
            console.error('Error opening INBOX:', err);
            return;
        }
        console.log('INBOX opened');

        // Search and process unseen messages initially
        searchAndProcessUnseenMessages();

        // Set up a polling interval to check for new messages
        setInterval(() => {
            console.log('Polling for new messages...');
            searchAndProcessUnseenMessages();
        }, pollingInterval);
    });
});

imap.once('error', (err) => {
    console.error('IMAP error:', err);
});

imap.once('end', () => {
    console.log('Connection ended');
});

const redacted = {
    user: emailConfig.user,
    host: emailConfig.host,
    port: emailConfig.port,
    tls: emailConfig.tls
};
console.log('Connecting to IMAP server with config:', redacted); // Debugging line
if (!deployTimeOffset) {
    console.log('Deploy Time:', deployTime.toLocaleString()); // Debugging line
} else {
    console.log('Deploy Time:', deployTime.toLocaleString(), `(offset by ${deployTimeOffset} minutes)`); // Debugging line
}
imap.connect();