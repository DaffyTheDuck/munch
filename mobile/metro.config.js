// Lets Metro bundle the code shared with the web app (../shared) alongside this project.
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const config = getDefaultConfig(__dirname)
config.watchFolders = [...(config.watchFolders || []), path.resolve(__dirname, '../shared')]

module.exports = config
