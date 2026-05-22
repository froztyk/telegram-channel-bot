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
const ADMIN_ID = process.env.ADMIN_ID;

const DB_FILE = 'data.json';

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

const client = new TonClient({
  endpoint: 'https://toncenter.com/api/v2/jsonRPC',
});

bot.command('start', async (ctx) => {
  try {
    const userId = String(ctx.from.id);
    const name = ctx.from.first_name;
    const db = loadDB();

    if (db.paid.includes(userId)) {
      return ctx.reply('✅ Hi ' + name + '! You already have access.');
    }

    if (!db.pending[userId]) {
      db.pending[userId] = 'join' + userId + Date.now();
      saveDB(db);
    }

    const memo = db.pending[userId];
    const nanotons = Math.floor(PRICE * 1e9);
    const tonkeeperLink =
      'https://app.tonkeeper.com/transfer/' + YOUR_WALLET +
      '?amount=' + nanotons + '&text=' + encodeURIComponent(memo);

    await ctx.reply(
      '👋 Hello ' + name + '!\n\nPay <b>' + PRICE + ' TON</b> to join.\n\n👀 You can preview before buying.',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '💎 Pay ' + PRICE + ' TON', url: tonkeeperLink }],
            [{ text: '✅ I paid', callback_data: 'verify' }],
            [{ text: '👀 See previews', callback_data: 'preview' }]
          ]
        }
      }
    );
  } catch (e) {
    console.error('Start error:', e);
  }
});

bot.action('preview', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch {}
  try {
    const db = loadDB();

    if (!db.previews || db.previews.length === 0) {
      return ctx.reply('📸 No previews yet.');
    }

    const previews = db.previews.slice(0, 20);
    const chunks = [];
    for (let i = 0; i < previews.length; i += 10) {
      chunks.push(previews.slice(i, i + 10));
    }

    for (let i = 0; i < chunks.length; i++) {
      const media = chunks[i].map((fileId, index) => ({
        type: 'photo',
        media: fileId,
        ...(index === 0 ? { caption: '👀 Preview ' + (i + 1) + '/' + chunks.length } : {})
      }));
      try {
        await ctx.replyWithMediaGroup(media);
        await new Promise(r => setTimeout(r, 1200));
      } catch (e) {
        console.error('Media send error:', e);
        await ctx.reply('⚠️ Some previews failed to load.');
      }
    }

    const userId = String(ctx.from.id);
    const memo = db.pending[userId];
    const nanotons = Math.floor(PRICE * 1e9);
    const tonkeeperLink =
      'https://app.tonkeeper.com/transfer/' + YOUR_WALLET +
      '?amount=' + nanotons + '&text=' + encodeURIComponent(memo || 'join');

    await ctx.reply(
      '🔥 Full content includes:\n\n• 150+ pics\n• 200+ videos\n• Voice messages\n• Weekly updates\n\n👤 Admin: @kseniooa\n\n💎 Price: <b>' + PRICE + ' TON</b>',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '💎 Pay ' + PRICE + ' TON', url: tonkeeperLink }],
            [{ text: '✅ I paid', callback_data: 'verify' }]
          ]
        }
      }
    );
  } catch (e) {
    console.error('Preview error:', e);
  }
});

bot.on('photo', async (ctx) => {
  try {
    if (String(ctx.from.id) !== ADMIN_ID) return;
    const db = loadDB();
    if (db.previews.length >= 20) {
      return ctx.reply('❌ Max 20 previews. Use /clearphotos');
    }
    const photo = ctx.message.photo.at(-1).file_id;
    db.previews.push(photo);
    saveDB(db);
    ctx.reply('✅ Saved (' + db.previews.length + '/20)');
  } catch (e) {
    console.error('Photo error:', e);
  }
});

bot.command('clearphotos', async (ctx) => {
  try {
    if (String(ctx.from.id) !== ADMIN_ID) return;
    const db = loadDB();
    db.previews = [];
    saveDB(db);
    ctx.reply('🗑️ All previews cleared.');
  } catch (e) {
    console.error('Clearphotos error:', e);
  }
});

bot.command('paid', async (ctx) => {
  try {
    if (String(ctx.from.id) !== ADMIN_ID) return;
    const db = loadDB();
    if (db.paid.length === 0) return ctx.reply('No paid users yet.');
    ctx.reply('✅ Paid users:\n' + db.paid.join('\n'));
  } catch (e) {
    console.error('Paid error:', e);
  }
});

bot.action('verify', async (ctx) => {
  try { await ctx.answerCbQuery('Checking...'); } catch {}
  try {
    const userId = String(ctx.from.id);
    const db = loadDB();
    const memo = db.pending[userId];

    if (!memo) return ctx.reply('⚠️ No pending payment. Use /start first.');

    const paid = await checkPayment(YOUR_WALLET, memo, PRICE);

    if (!paid) {
      return ctx.reply('❌ Payment not found yet. Wait a minute and try again.');
    }

    db.paid.push(userId);
    delete db.pending[userId];
    saveDB(db);

    try {
      const link = await ctx.telegram.createChatInviteLink(CHANNEL_ID, {
        member_limit: 1
      });
      await ctx.reply(
        '🎉 Payment confirmed! Welcome!\n\n👉 Your invite link:\n' + link.invite_link + '\n\n⚠️ Single use only — do not share it!'
      );
    } catch (e) {
      console.error('Invite link error:', e);
      await ctx.reply('✅ Payment confirmed! Contact @kseniooa for access.');
    }
  } catch (e) {
    console.error('Verify error:', e);
  }
});

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
    console.error('TON check error:', e);
  }
  return false;
}

app.get('/', (req, res) => res.send('Bot is running ✅'));

app.listen(process.env.PORT || 3000, () => {
  console.log('Server running');
});

bot.launch();
console.log('Bot running');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
