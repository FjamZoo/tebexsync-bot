import dotenv from 'dotenv';

import { DBConnectionDetails } from '../types';

dotenv.config();

const fields = {
  DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
  MAIN_GUILD_ID: process.env.MAIN_GUILD_ID,

  // Ticket System
  TICKET_OPENER_CHANNEL_ID: process.env.TICKET_OPENER_CHANNEL_ID,
  TRANSCRIPT_CHANNEL_ID: process.env.TRANSCRIPT_CHANNEL_ID,
  STAFF_ROLE_IDS: process.env.STAFF_ROLE_IDS || process.env.STAFF_ROLE_ID,

  // SQLite setup
  SQLITE_PATH: process.env.SQLITE_PATH,

  // SQL setup
  SQL_HOST: process.env.SQL_HOST,
  SQL_PORT: Number(process.env.SQL_PORT) || undefined,
  SQL_USER: process.env.SQL_USER,
  SQL_DATABASE: process.env.SQL_DATABASE,
  SQL_PASSWORD: process.env.SQL_PASSWORD,

  // Tebex secret
  TEBEX_SECRET: process.env.TEBEX_SECRET,
};

interface Config extends DBConnectionDetails {
  DISCORD_BOT_TOKEN: string;
  MAIN_GUILD_ID: string;
  TICKET_OPENER_CHANNEL_ID: string | undefined;
  TRANSCRIPT_CHANNEL_ID: string | undefined;
  STAFF_ROLE_IDS: string[];
  TEBEX_SECRET: string | false
};

if (!fields.DISCORD_BOT_TOKEN) {
  throw new Error('No Discord Token was provided in the environment variables, make sure it\'s set under "DISCORD_BOT_TOKEN"')
}

if (!fields.MAIN_GUILD_ID) {
  throw new Error('No MAIN_GUILD_ID detected, this is required !')
}

const env: Config = {
  DISCORD_BOT_TOKEN: fields.DISCORD_BOT_TOKEN,
  MAIN_GUILD_ID: fields.MAIN_GUILD_ID,
  TICKET_OPENER_CHANNEL_ID: fields.TICKET_OPENER_CHANNEL_ID,
  TRANSCRIPT_CHANNEL_ID: fields.TRANSCRIPT_CHANNEL_ID,
  STAFF_ROLE_IDS: fields.STAFF_ROLE_IDS ? fields.STAFF_ROLE_IDS.split(',').map(id => id.trim()) : [],
  SQLITE_PATH: fields.SQLITE_PATH,
  SQL_HOST: fields.SQL_HOST,
  SQL_PORT: fields.SQL_PORT,
  SQL_USER: fields.SQL_USER,
  SQL_DATABASE: fields.SQL_DATABASE,
  SQL_PASSWORD: fields.SQL_PASSWORD,
  TEBEX_SECRET: fields.TEBEX_SECRET ?? false,
}

export default env;
