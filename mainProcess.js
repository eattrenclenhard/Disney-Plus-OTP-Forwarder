require('dotenv').config();
const Imap = require('node-imap');
const TelegramBot = require('node-telegram-bot-api');
const cheerio = require('cheerio');
const simpleParser = require('mailparser').simpleParser;
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
    chatIds: process.env.TELEGRAM_CHAT_ID.split(',').map(id => id.trim()),
};

const pollingInterval = parseInt(process.env.POLLING_INTERVAL, 10) || 300000;
const forwardHistoricalEmail = process.env.FORWARD_HISTORICAL_EMAIL === 'true';
const markForwardedSeen = process.env.MARK_FORWARDED_SEEN === 'true';
const deployTimeOffset = parseInt(process.env.DEPLOY_TIME_OFFSET, 0) || 0;

const imap = new Imap(emailConfig);
const bot = new TelegramBot(telegramConfig.token);

const deployTime = moment().utc().add(deployTimeOffset, 'minutes').toDate();

function openInbox(cb) {
    imap.openBox('INBOX', false, cb);
}

function extractPasscodeFromHtml(html) {
    const $ = cheerio.load(html);
    $('script, style').remove();
    const textContent = $('body').text();
    const passcodeMatch = textContent.match(/^\d{6}$/);
    if (passcodeMatch && passcodeMatch[0]) {
        console.log('Passcode found:', passcodeMatch[0]);
        return passcodeMatch[0];
    }
    console.log('No passcode found');
    return '';
}

function searchAndProcessUnseenMessages() {
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

    console.log('Search Criteria:', searchCriteria);

    imap.search(searchCriteria, (err, results) => {
        if (err) {
            console.error('Error searching for emails:', err);
            return;
        }

        console.log('Search Results:', results);

        if (results.length === 0) {
            console.log('No new unseen messages found.');
            return;
        }

        for (let index = 0; index < results.length; index++) {
            processEmailsSequentially(results, index);
        }
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
                    processEmailsSequentially(results, index + 1);
                    return;
                }

                emailDetails.parsed = parsed;

                let body = '';
                if (parsed.html) {
                    body = parsed.html;
                } else if (parsed.text) {
                    body = parsed.text;
                }

                const passcode = extractPasscodeFromHtml(body);
                console.log('Extracted Passcode:', passcode);

                const offset = moment().format('Z');
                console.log(`Timezone: ${offset}`);
                let messageContent = `Date: ${parsed.date.toLocaleString()}\n`;
                if (passcode) {
                    messageContent += `Passcode: \`${passcode}\``;
                } else {
                    messageContent += 'Passcode not found in the email.';
                }

                telegramConfig.chatIds.forEach(chatId => {
                    bot.sendMessage(chatId, messageContent, { parse_mode: 'MarkdownV2' })
                        .then(() => {
                            console.log('Message sent to Telegram chat ID:', chatId);
                            if (markForwardedSeen) {
                                console.log('marking email as seen...');
                                markEmailAsSeen(results[index], () => {
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
        });

        msg.once('end', () => {
            console.log('Done fetching message:', results[index]);
            console.log('Email Details:', emailDetails);
        });
    });

    f.once('error', (err) => {
        console.error('Fetch error:', err);
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
        searchAndProcessUnseenMessages();
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
console.log('Connecting to IMAP server with config:', redacted);
if (!deployTimeOffset) {
    console.log('Deploy Time:', deployTime.toLocaleString());
} else {
    console.log('Deploy Time:', deployTime.toLocaleString(), `(offset by ${deployTimeOffset} minutes)`);
}
imap.connect();