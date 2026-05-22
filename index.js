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

const ADMIN_ID = '8705649572';

const DB_FILE = 'data.json';

// ================= DATABASE =================

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    return { pending: {}, paid: [], previews: [] };
  }

  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  if (!db.previews) db.previews = [];
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
  const userId = String(ctx.from.id);
  const name = ctx.from.first_name;

  const db = loadDB();

  if (db.paid.includes(userId)) {
    return ctx.reply(`✅ Hi ${name}! You already have access.`);
  }

  const memo = `join${userId}${Date.now()}`;
  db.pending[userId] = memo;
  saveDB(db);

  const nanotons = Math.floor(PRICE * 1e9);

  const tonkeeperLink =
    `https://app.tonkeeper.com/transfer/${YOUR_WALLET}` +
    `?amount=${nanotons}&text=${encodeURIComponent(memo)}`;

  await ctx.reply(
    `👋 Hello ${name}!\n\nPay <b>${PRICE} TON</b> to join.\n\n👀 You can preview before buying.`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: `💎 Pay ${PRICE} TON`, url: tonkeeperLink }],
          [{ text: '✅ I paid', callback_data: 'verify' }],
          [{ text: '👀 See previews', callback_data: 'preview' }]
        ]
      }
    }
  );
});

// ================= FIXED PREVIEW =================

bot.action('preview', async (ctx) => {
  await ctx.answerCbQuery();

  const db = loadDB();

  if (!db.previews || db.previews.length === 0) {
    return ctx.reply('📸 No previews yet.');
  }

  const previews = db.previews.slice(0, 20);

  // split into safe chunks of 10
  const chunks = [];
  for (let i = 0; i < previews.length; i += 10) {
    chunks.push(previews.slice(i, i + 10));
  }

  for (let i = 0; i < chunks.length; i++) {
    const media = chunks[i].map((fileId, index) => ({
      type: 'photo',
      media: fileId,
      ...(index === 0
        ? { caption: `👀 Preview ${i + 1}/${chunks.length}` }
        : {})
    }));

    try {
      await ctx.replyWithMediaGroup(media);
      await new Promise(r => setTimeout(r, 1200)); // avoid Telegram limit
    } catch (e) {
      console.error('Media send error:', e);
      await ctx.reply('⚠️ Some previews failed to load.');
    }
  }

  const userId = String(ctx.from.id);
  const memo = db.pending[userId];

  const nanotons = Math.floor(PRICE * 1e9);

  const tonkeeperLink =
    `https://app.tonkeeper.com/transfer/${YOUR_WALLET}` +
    `?amount=${nanotons}&text=${encodeURIComponent(memo || 'join')}`;

  await ctx.reply(
    `🔥 Full content includes:\n\n` +
    `• 150+ pics\n` +
    `• 200+ videos (5–10 min 🐾🍑🍒)\n` +
    `• Voice messages\n` +
    `• Weekly updates\n\n` +
    `👤 Admin: @kseniooa\n\n` +
    `💎 Price: <b>${PRICE} TON</b>`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: `💎 Pay ${PRICE} TON`, url: tonkeeperLink }],
          [{ text: '✅ I paid', callback_data: 'verify' }]
        ]
      }
    }
  );
});

// ================= ADMIN ADD PHOTO =================

bot.on('photo', async (ctx) => {
  if (String(ctx.from.id) !== ADMIN_ID) return;

  const db = loadDB();

  if (db.previews.length >= 20) {
    return ctx.reply('❌ Max 20 previews reached. Use /clearphotos');
  }

  const photo = ctx.message.photo.at(-1).file_id;
  db.previews.push(photo);
  saveDB(db);

  ctx.reply(`✅ Saved (${db.previews.length}/20)`);
});

// ================= VERIFY PAYMENT =================

bot.action('verify', async (ctx) => {
  await ctx.answerCbQuery('Checking...');

  const userId = String(ctx.from.id);
  const db = loadDB();
  const memo = db.pending[userId];

  if (!memo) return ctx.reply('No payment found. Use /start');

  const paid = await checkPayment(YOUR_WALLET, memo, PRICE);

  if (!paid) {
    return ctx.reply('❌ Not found yet. Try again later.');
  }

  db.paid.push(userId);
  delete db.pending[userId];
  saveDB(db);

  await ctx.reply('🎉 Payment confirmed! Access granted.');
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

bot.launch();
console.log('Bot running');

process.once('SIGINT', () => bot.stop());
process.once('SIGTERM', () => bot.stop());