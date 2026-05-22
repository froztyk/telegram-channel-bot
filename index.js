require('dotenv').config();
const { Telegraf } = require('telegraf');
const express = require('express');
const { TonClient, Address } = require('@ton/ton');
const fs = require('fs');

const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();

const PRICE = parseFloat(process.env.PRICE_TON);
const YOUR_WALLET = process.env.TON_WALLET;
const CHANNEL_ID = process.env.CHANNEL_ID;

// ✅ FIXED ADMIN ID (NUMBER, NOT STRING)
const ADMIN_ID = 8705649572;

const DB_FILE = 'data.json';

// ================= DATABASE =================

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    return {
      pending: {},
      paid: [],
      previews: [],
      stats: {
        start: 0,
        preview: 0,
        verify: 0
      }
    };
  }

  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

  if (!db.previews) db.previews = [];
  if (!db.stats) db.stats = { start: 0, preview: 0, verify: 0 };

  return db;
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ================= TON CLIENT =================

const client = new TonClient({
  endpoint: 'https://toncenter.com/api/v2/jsonRPC',
});

// ================= START =================

bot.start(async (ctx) => {
  const db = loadDB();
  db.stats.start++;
  saveDB(db);

  const userId = String(ctx.from.id);
  const name = ctx.from.first_name;

  if (db.paid.includes(userId)) {
    return ctx.reply(`✅ Hi ${name}, you already have access.`);
  }

  const memo = `join${userId}${Date.now()}`;
  db.pending[userId] = memo;
  saveDB(db);

  const nanotons = Math.floor(PRICE * 1e9);

  const tonkeeperLink =
    `https://app.tonkeeper.com/transfer/${YOUR_WALLET}` +
    `?amount=${nanotons}` +
    `&text=${encodeURIComponent(memo)}`;

  await ctx.reply(
    `👋 Welcome ${name}\n\nPay <b>${PRICE} TON</b> to unlock.`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: `💎 Pay ${PRICE} TON`, url: tonkeeperLink }],
          [{ text: '✅ I paid', callback_data: 'verify' }],
          [{ text: '👀 Preview', callback_data: 'preview' }]
        ]
      }
    }
  );
});

// ================= PREVIEW =================

bot.action('preview', async (ctx) => {
  await ctx.answerCbQuery();

  const db = loadDB();
  db.stats.preview++;
  saveDB(db);

  if (db.previews.length === 0) {
    return ctx.reply('No previews yet.');
  }

  const media = db.previews.slice(0, 10).map((fileId, i) => ({
    type: 'photo',
    media: fileId,
    ...(i === 0 && { caption: '👀 Preview' })
  }));

  await ctx.replyWithMediaGroup(media);

  await ctx.reply(
    `🔥 Channel includes:\n\n` +
    `• 150+ pics\n` +
    `• 200+ videos\n` +
    `• Voice messages\n\n` +
    `🎥 5–10 min videos 🐾🍑🍒\n\n` +
    `👤 Admin: @kseniooa\n\n` +
    `💎 Price: <b>${PRICE} TON</b>`,
    { parse_mode: 'HTML' }
  );
});

// ================= VERIFY =================

bot.action('verify', async (ctx) => {
  await ctx.answerCbQuery('Checking...');

  const db = loadDB();
  db.stats.verify++;
  saveDB(db);

  const userId = String(ctx.from.id);
  const memo = db.pending[userId];

  if (!memo) return ctx.reply('No payment found.');

  const paid = await checkPayment(YOUR_WALLET, memo, PRICE);

  if (!paid) {
    return ctx.reply('❌ Not detected yet.');
  }

  db.paid.push(userId);
  delete db.pending[userId];
  saveDB(db);

  const link = await bot.telegram.createChatInviteLink(CHANNEL_ID, {
    member_limit: 1,
    expire_date: Math.floor(Date.now() / 1000) + 86400
  });

  await ctx.reply(`🎉 Access granted:\n${link.invite_link}`);
});

// ================= ADMIN /SEE COMMAND =================

bot.command('see', async (ctx) => {
  // ✅ FIXED CHECK
  if (Number(ctx.from.id) !== ADMIN_ID) return;

  const db = loadDB();

  const totalStarts = db.stats.start;
  const previews = db.stats.preview;
  const verifications = db.stats.verify;
  const paid = db.paid.length;
  const pending = Object.keys(db.pending).length;

  await ctx.reply(
    `📊 BOT STATS\n\n` +
    `🚀 /start used: ${totalStarts}\n` +
    `👀 preview clicks: ${previews}\n` +
    `🔍 verify clicks: ${verifications}\n\n` +
    `💰 Paid users: ${paid}\n` +
    `⏳ Pending: ${pending}`
  );
});

// ================= PHOTO =================

bot.on('photo', async (ctx) => {
  if (Number(ctx.from.id) !== ADMIN_ID) return;

  const db = loadDB();
  const fileId = ctx.message.photo.pop().file_id;

  db.previews.push(fileId);
  saveDB(db);

  await ctx.reply(`Saved (${db.previews.length})`);
});

// ================= TON CHECK =================

async function checkPayment(walletAddress, memo, expectedTon) {
  try {
    const address = Address.parse(walletAddress);
    const txs = await client.getTransactions(address, { limit: 30 });

    for (const tx of txs) {
      const inMsg = tx.inMessage;
      if (!inMsg) continue;

      let comment = '';

      try {
        const slice = inMsg.body.beginParse();
        if (slice.remainingBits >= 32 && slice.loadUint(32) === 0) {
          comment = slice.loadStringTail();
        }
      } catch {}

      if (comment === memo) {
        const value = Number(inMsg.info.value.coins) / 1e9;
        if (value >= expectedTon * 0.98) return true;
      }
    }
  } catch (e) {
    console.error(e);
  }

  return false;
}

// ================= SERVER =================

app.get('/', (req, res) => res.send('Bot running'));
app.listen(3000);

// ================= START =================

bot.launch();
console.log('Bot running');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));