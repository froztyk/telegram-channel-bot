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

// YOUR TELEGRAM USER ID
const ADMIN_ID = '8705649572';

const DB_FILE = 'data.json';

// ================= DATABASE =================

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    return {
      pending: {},
      paid: [],
      previews: []
    };
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

// ================= START COMMAND =================

bot.start(async (ctx) => {
  const userId = String(ctx.from.id);
  const name = ctx.from.first_name;

  const db = loadDB();

  // Already paid
  if (db.paid.includes(userId)) {
    return ctx.reply(
      `✅ Hi ${name}!\n\nYou already have access to the private channel.`
    );
  }

  // Generate unique memo
  const memo = `join${userId}${Date.now()}`;

  db.pending[userId] = memo;
  saveDB(db);

  const nanotons = Math.floor(PRICE * 1e9);

  const tonkeeperLink =
    `https://app.tonkeeper.com/transfer/${YOUR_WALLET}` +
    `?amount=${nanotons}` +
    `&text=${encodeURIComponent(memo)}`;

  await ctx.reply(
    `👋 Hello ${name}!\n\n` +
    `To join the private channel, pay <b>${PRICE} TON</b>.\n\n` +
    `1️⃣ Tap the payment button\n` +
    `2️⃣ Confirm payment in Tonkeeper\n` +
    `3️⃣ Return here and tap "I paid"\n\n` +
    `👀 You can preview the channel before buying.`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: `💎 Pay ${PRICE} TON`,
              url: tonkeeperLink
            }
          ],
          [
            {
              text: '✅ I paid — give me access',
              callback_data: 'verify'
            }
          ],
          [
            {
              text: '👀 See previews',
              callback_data: 'preview'
            }
          ]
        ]
      }
    }
  );
});

// ================= PREVIEW BUTTON =================

bot.action('preview', async (ctx) => {
  await ctx.answerCbQuery();

  const db = loadDB();

  if (db.previews.length === 0) {
    return ctx.reply('📸 No preview photos added yet.');
  }

  // Split previews into groups of 10
  const album1 = db.previews.slice(0, 10);
  const album2 = db.previews.slice(10, 20);

  // First album
  if (album1.length > 0) {
    const media1 = album1.map((fileId, index) => ({
      type: 'photo',
      media: fileId,
      ...(index === 0 && {
        caption: '👀 Preview photos (1/2)'
      })
    }));

    await ctx.replyWithMediaGroup(media1);
  }

  // Second album
  if (album2.length > 0) {
    const media2 = album2.map((fileId, index) => ({
      type: 'photo',
      media: fileId,
      ...(index === 0 && {
        caption: '👀 Preview photos (2/2)'
      })
    }));

    await ctx.replyWithMediaGroup(media2);
  }

  // Rebuild payment button
  const userId = String(ctx.from.id);

  const memo = db.pending[userId];

  const nanotons = Math.floor(PRICE * 1e9);

  const tonkeeperLink =
    `https://app.tonkeeper.com/transfer/${YOUR_WALLET}` +
    `?amount=${nanotons}` +
    `&text=${encodeURIComponent(memo || 'join')}`;

  // Message after previews
  await ctx.reply(
    `🔥 These are the creators featured inside the private channel.\n\n` +
    `📦 This channel includes:\n` +
    `• 150+ pics\n` +
    `• 200+ videos\n` +
    `• Voice messages\n` +
    `• New content added weekly\n\n` +
    `👤 Admin: @kseniooa\n\n` +
    `💎 Unlock full access for only <b>${PRICE} TON</b>.`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: `💎 Pay ${PRICE} TON`,
              url: tonkeeperLink
            }
          ],
          [
            {
              text: '✅ I paid — give me access',
              callback_data: 'verify'
            }
          ]
        ]
      }
    }
  );
});

// ================= ADMIN COMMANDS =================

// Add preview photos
bot.command('addphoto', async (ctx) => {
  const userId = String(ctx.from.id);

  if (userId !== ADMIN_ID) return;

  const db = loadDB();

  await ctx.reply(
    `📸 Send preview photos now.\n\n` +
    `Currently saved: ${db.previews.length}/20`
  );
});

// Clear preview photos
bot.command('clearphotos', async (ctx) => {
  const userId = String(ctx.from.id);

  if (userId !== ADMIN_ID) return;

  const db = loadDB();

  db.previews = [];

  saveDB(db);

  await ctx.reply('✅ All preview photos deleted.');
});

// Check preview count
bot.command('photostatus', async (ctx) => {
  const userId = String(ctx.from.id);

  if (userId !== ADMIN_ID) return;

  const db = loadDB();

  await ctx.reply(
    `📸 Preview photos saved: ${db.previews.length}/20`
  );
});

// Receive photos from admin
bot.on('photo', async (ctx) => {
  const userId = String(ctx.from.id);

  if (userId !== ADMIN_ID) return;

  const db = loadDB();

  if (db.previews.length >= 20) {
    return ctx.reply(
      '❌ Maximum of 20 preview photos reached.\n\nUse /clearphotos first.'
    );
  }

  const photo = ctx.message.photo[ctx.message.photo.length - 1];

  const fileId = photo.file_id;

  db.previews.push(fileId);

  saveDB(db);

  await ctx.reply(
    `✅ Photo saved.\n\n` +
    `Current total: ${db.previews.length}/20`
  );
});

// ================= VERIFY PAYMENT =================

bot.action('verify', async (ctx) => {
  await ctx.answerCbQuery('🔍 Checking blockchain...');

  const userId = String(ctx.from.id);

  const db = loadDB();

  const memo = db.pending[userId];

  if (!memo) {
    return ctx.reply(
      '❌ No pending payment found.\n\nUse /start first.'
    );
  }

  await ctx.reply(
    '⏳ Verifying your TON payment...'
  );

  const paid = await checkPayment(
    YOUR_WALLET,
    memo,
    PRICE
  );

  if (!paid) {
    return ctx.reply(
      `❌ Payment not found yet.\n\n` +
      `Make sure:\n` +
      `• You sent the exact amount\n` +
      `• You included the memo/comment\n` +
      `• You wait 1-2 minutes after payment\n\n` +
      `Then tap the button again.`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🔄 Check Again',
                callback_data: 'verify'
              }
            ]
          ]
        }
      }
    );
  }

  // Mark as paid
  db.paid.push(userId);

  delete db.pending[userId];

  saveDB(db);

  // Generate invite link
  try {
    const link = await bot.telegram.createChatInviteLink(
      CHANNEL_ID,
      {
        member_limit: 1,
        expire_date:
          Math.floor(Date.now() / 1000) + 86400
      }
    );

    await ctx.reply(
      `🎉 Payment confirmed!\n\n` +
      `Here is your private invite link:\n\n` +
      `${link.invite_link}\n\n` +
      `⚠️ This link works once and expires in 24 hours.`
    );

  } catch (e) {
    console.error('Invite link error:', e);

    await ctx.reply(
      '✅ Payment confirmed!\n\n' +
      'Please contact admin for access.'
    );
  }
});

// ================= CHECK TON PAYMENT =================

async function checkPayment(
  walletAddress,
  memo,
  expectedTon
) {
  try {
    const address = Address.parse(walletAddress);

    const txs = await client.getTransactions(
      address,
      { limit: 30 }
    );

    for (const tx of txs) {
      const inMsg = tx.inMessage;

      if (!inMsg) continue;

      let comment = '';

      try {
        const slice = inMsg.body.beginParse();

        if (
          slice.remainingBits >= 32 &&
          slice.loadUint(32) === 0
        ) {
          comment = slice.loadStringTail();
        }

      } catch {}

      if (comment === memo) {
        const value =
          Number(inMsg.info.value.coins) / 1e9;

        if (value >= expectedTon * 0.98) {
          return true;
        }
      }
    }

  } catch (e) {
    console.error('TON API error:', e);
  }

  return false;
}

// ================= EXPRESS =================

app.get('/', (req, res) => {
  res.send('Bot is running.');
});

app.listen(3000, () => {
  console.log('🌐 Server running on port 3000');
});

// ================= START BOT =================

bot.launch();

console.log('✅ Telegram bot is running!');

// ================= STOP HANDLERS =================

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));