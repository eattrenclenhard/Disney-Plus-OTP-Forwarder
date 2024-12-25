require('dotenv').config();
const { fork } = require('child_process');
const path = require('path');

const botController = fork(path.join(__dirname, 'botController.js'));

botController.on('exit', () => {
    console.log('Bot controller process exited');
});