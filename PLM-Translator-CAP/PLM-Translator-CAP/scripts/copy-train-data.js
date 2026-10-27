'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
fs.cpSync(path.join(root, 'Train_Data'), path.join(root, 'gen', 'srv', 'Train_Data'), { recursive: true });
