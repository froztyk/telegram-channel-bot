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
const STARS_CHANNEL_ID = '-1003605323076';
const STARS_PRICE = 2500;
const ADMIN_ID = process.env.ADMIN_ID;

const DB_FILE = 'data.json';

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    return {
      pending: {},
      paid: [],
      paidStars: [],
      previews: [],
      adultPreviews: [],   // NEW: album for 18+ preview
      users: [],
      stats: { starts: 0, previewClicks: 0, adultPreviewClicks: 0 }
    };
  }
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  if (!db.previews) db.previews = [];
  if (!db.adultPreviews) db.adultPreviews = [];
  if (!db.users) db.users = [];
  if (!db.paidStars) db.paidStars = [];
  if (!db.stats) db.stats = { starts: 0, previewClicks: 0, adultPreviewClicks: 0 };
  if (!db.stats.starts) db.stats.starts = 0;
  if (!db.stats.previewClicks) db.stats.previewClicks = 0;
  if (!db.stats.adultPreviewClicks) db.stats.adultPreviewClicks = 0;
  return db;
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

const client = new TonClient({
  endpoint: 'https://toncenter.com/api/v2/jsonRPC',
});

// ─── /start ────────────────────────────────────────────────────────────────

bot.command('start', async (ctx) => {
  try {
    const userId = String(ctx.from.id);
    const name = ctx.from.first_name;
    const db = loadDB();

    if (!db.users.includes(userId)) {
      db.users.push(userId);
    }
    db.stats.starts += 1;
    saveDB(db);

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
            [{ text: '💎 Buy for ' + PRICE + ' TON ~46$', url: tonkeeperLink }],
            [{ text: '⭐ Buy for ' + STARS_PRICE + ' Stars ~60$', callback_data: 'buy_stars' }],
            [{ text: '✅ I paid (TON)', callback_data: 'verify' }],
            [{ text: '👀 See previews', callback_data: 'preview' }],
            [{ text: '🔞 18+ Preview', callback_data: 'adult_preview' }]
          ]
        }
      }
    );
  } catch (e) {
    console.error('Start error:', e);
  }
});

// ─── Stars purchase ─────────────────────────────────────────────────────────

bot.action('buy_stars', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch {}
  try {
    await ctx.reply(
      '⭐ To get access, join the channel below for <b>' + STARS_PRICE + ' Stars</b>.\n\nAfter joining you will find the link inside.',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '⭐ Join for ' + STARS_PRICE + ' Stars', url: 'https://t.me/+1sGbJzUH4g00NjZh' }]
          ]
        }
      }
    );
  } catch (e) {
    console.error('Stars button error:', e);
  }
});

// ─── Preview (original) ──────────────────────────────────────────────────────

bot.action('preview', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch {}
  try {
    const db = loadDB();

    db.stats.previewClicks += 1;
    saveDB(db);

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
      '🔥 Channel includes 18+content from creators shown above:\n\n• 150+ pics\n• 200+ videos\n• Voice messages\n•\n\n👤 Admin: @kseniooa\n\n💎 Price: <b>' + PRICE + ' TON</b>',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '💎 Buy for ' + PRICE + ' TON', url: tonkeeperLink }],
            [{ text: '⭐ Buy for ' + STARS_PRICE + ' Stars', callback_data: 'buy_stars' }],
            [{ text: '✅ I paid (TON)', callback_data: 'verify' }]
          ]
        }
      }
    );
  } catch (e) {
    console.error('Preview error:', e);
  }
});

// ─── 18+ Preview: send random item ──────────────────────────────────────────

async function sendRandomAdultPreview(ctx) {
  const db = loadDB();

  if (!db.adultPreviews || db.adultPreviews.length === 0) {
    return ctx.reply('📸 No 18+ previews available yet.');
  }

  const item = db.adultPreviews[Math.floor(Math.random() * db.adultPreviews.length)];

  const seeMoreKeyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '👁 See more', callback_data: 'adult_preview_more' }],
        [{ text: '💎 Buy for ' + PRICE + ' TON', callback_data: 'show_buy' }]
      ]
    }
  };

  try {
    if (item.type === 'photo') {
      await ctx.replyWithPhoto(item.fileId, {
        caption: '🔞 18+ Preview\n\nWant full access? Buy now 👇',
        ...seeMoreKeyboard
      });
    } else if (item.type === 'video') {
      await ctx.replyWithVideo(item.fileId, {
        caption: '🔞 18+ Preview\n\nWant full access? Buy now 👇',
        ...seeMoreKeyboard
      });
    }
  } catch (e) {
    console.error('Send adult preview error:', e);
    await ctx.reply('⚠️ Could not load preview. Try again.');
  }
}

// ─── 18+ Preview button ──────────────────────────────────────────────────────

bot.action('adult_preview', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch {}
  try {
    const db = loadDB();
    db.stats.adultPreviewClicks += 1;
    saveDB(db);
    await sendRandomAdultPreview(ctx);
  } catch (e) {
    console.error('Adult preview error:', e);
  }
});

// ─── "See more" button ────────────────────────────────────────────────────────

bot.action('adult_preview_more', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch {}
  try {
    await sendRandomAdultPreview(ctx);
  } catch (e) {
    console.error('Adult preview more error:', e);
  }
});

// ─── Show buy keyboard (fallback) ────────────────────────────────────────────

bot.action('show_buy', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch {}
  try {
    const userId = String(ctx.from.id);
    const db = loadDB();
    const memo = db.pending[userId] || ('join' + userId + Date.now());
    if (!db.pending[userId]) {
      db.pending[userId] = memo;
      saveDB(db);
    }
    const nanotons = Math.floor(PRICE * 1e9);
    const tonkeeperLink =
      'https://app.tonkeeper.com/transfer/' + YOUR_WALLET +
      '?amount=' + nanotons + '&text=' + encodeURIComponent(memo);

    await ctx.reply(
      '💎 Get full access for <b>' + PRICE + ' TON</b>',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '💎 Buy for ' + PRICE + ' TON', url: tonkeeperLink }],
            [{ text: '⭐ Buy for ' + STARS_PRICE + ' Stars', callback_data: 'buy_stars' }],
            [{ text: '✅ I paid (TON)', callback_data: 'verify' }]
          ]
        }
      }
    );
  } catch (e) {
    console.error('Show buy error:', e);
  }
});

// ─── Admin: /preview (upload 18+ album) ──────────────────────────────────────

let previewMode = false;

bot.command('preview', async (ctx) => {
  if (String(ctx.from.id) !== ADMIN_ID) return;
  previewMode = true;
  const db = loadDB();
  await ctx.reply(
    `📥 Preview upload mode ON.\n\nSend photos/videos one by one (up to 200).\nCurrent album size: ${db.adultPreviews.length}\n\nType /donepreview when finished.`
  );
});

bot.command('donepreview', async (ctx) => {
  if (String(ctx.from.id) !== ADMIN_ID) return;
  previewMode = false;
  const db = loadDB();
  await ctx.reply(`✅ Preview upload finished. Album now has ${db.adultPreviews.length} items.`);
});

// ─── Admin: /deletepreview ────────────────────────────────────────────────────

bot.command('deletepreview', async (ctx) => {
  if (String(ctx.from.id) !== ADMIN_ID) return;
  try {
    const db = loadDB();
    if (!db.adultPreviews || db.adultPreviews.length === 0) {
      return ctx.reply('⚠️ Album is already empty.');
    }
    const removed = db.adultPreviews.pop();
    saveDB(db);
    await ctx.reply(`🗑️ Removed last item (${removed.type}). Album now has ${db.adultPreviews.length} items.`);
  } catch (e) {
    console.error('Deletepreview error:', e);
  }
});

// ─── Admin: /clearphotos ────────────────────────────────────────────────────

bot.command('clearphotos', async (ctx) => {
  try {
    if (String(ctx.from.id) !== ADMIN_ID) return;
    const db = loadDB();
    db.previews = [];
    saveDB(db);
    await ctx.reply('🗑️ All (regular) previews cleared.');
  } catch (e) {
    console.error('Clearphotos error:', e);
  }
});

// ─── Admin: /paid ───────────────────────────────────────────────────────────

bot.command('paid', async (ctx) => {
  try {
    if (String(ctx.from.id) !== ADMIN_ID) return;
    const db = loadDB();
    if (db.paid.length === 0) return ctx.reply('No paid users yet.');
    await ctx.reply('✅ Paid users:\n' + db.paid.join('\n'));
  } catch (e) {
    console.error('Paid error:', e);
  }
});

// ─── Admin: /see ────────────────────────────────────────────────────────────

bot.command('see', async (ctx) => {
  try {
    if (String(ctx.from.id) !== ADMIN_ID) return;
    const db = loadDB();
    await ctx.reply(
      `📊 Statistics\n\n` +
      `👥 Unique users: ${db.users.length}\n` +
      `🚀 Total /start: ${db.stats.starts}\n` +
      `👀 Preview clicks: ${db.stats.previewClicks}\n` +
      `🔞 18+ Preview clicks: ${db.stats.adultPreviewClicks}\n` +
      `📸 18+ Album size: ${db.adultPreviews.length}\n` +
      `💎 Paid (TON): ${db.paid.length}\n` +
      `⭐ Paid (Stars): ${db.paidStars.length}\n` +
      `⏳ Pending payment: ${Object.keys(db.pending).length}`
    );
  } catch (e) {
    console.error('See error:', e);
  }
});

// ─── Admin: /ad broadcast ───────────────────────────────────────────────────

let adMode = false;

bot.command('ad', async (ctx) => {
  if (String(ctx.from.id) !== ADMIN_ID) return;
  adMode = true;
  await ctx.reply('📢 Ad mode ON.\nSend a text, photo, or video to broadcast to all users.\n/cancel to stop.');
});

bot.command('cancel', async (ctx) => {
  if (String(ctx.from.id) !== ADMIN_ID) return;
  adMode = false;
  previewMode = false;
  await ctx.reply('❌ Cancelled.');
});

// ─── Admin message handler ───────────────────────────────────────────────────

bot.use(async (ctx, next) => {
  if (!ctx.message) return next();
  if (String(ctx.from?.id) !== ADMIN_ID) return next();

  try {
    const text = ctx.message.text;
    const hasPhoto = !!ctx.message.photo;
    const hasVideo = !!ctx.message.video;

    if (text && text.startsWith('/')) return next();

    // ── 18+ preview upload mode ──
    if (previewMode) {
      const db = loadDB();
      if (db.adultPreviews.length >= 200) {
        return ctx.reply('❌ Max 200 items reached. Use /deletepreview to make room.');
      }
      if (hasPhoto) {
        const fileId = ctx.message.photo.at(-1).file_id;
        db.adultPreviews.push({ type: 'photo', fileId });
        saveDB(db);
        return ctx.reply(`✅ Photo saved to 18+ album (${db.adultPreviews.length}/200)`);
      } else if (hasVideo) {
        const fileId = ctx.message.video.file_id;
        db.adultPreviews.push({ type: 'video', fileId });
        saveDB(db);
        return ctx.reply(`✅ Video saved to 18+ album (${db.adultPreviews.length}/200)`);
      } else {
        return ctx.reply('⚠️ Send a photo or video. Type /donepreview when done.');
      }
    }

    // ── Broadcast (ad) mode ──
    if (adMode) {
      const db = loadDB();
      const users = db.users || [];

      if (users.length === 0) {
        adMode = false;
        return ctx.reply('⚠️ No users to send to.');
      }

      await ctx.reply(`📤 Sending to ${users.length} users...`);

      let sent = 0;
      let failed = 0;

      for (const userId of users) {
        try {
          if (hasPhoto) {
            await bot.telegram.sendPhoto(
              userId,
              ctx.message.photo.at(-1).file_id,
              { caption: ctx.message.caption || '' }
            );
          } else if (hasVideo) {
            await bot.telegram.sendVideo(
              userId,
              ctx.message.video.file_id,
              { caption: ctx.message.caption || '' }
            );
          } else if (text) {
            await bot.telegram.sendMessage(userId, text);
          }
          sent++;
        } catch (err) {
          console.error(`Failed to send to ${userId}:`, err.message);
          failed++;
        }
      }

      adMode = false;
      return ctx.reply(`✅ Broadcast done!\n📨 Sent: ${sent}\n❌ Failed: ${failed}`);
    }

    // ── Default: add to regular previews ──
    if (hasPhoto) {
      const db = loadDB();
      if (db.previews.length >= 20) {
        return ctx.reply('❌ Max 20 regular previews. Use /clearphotos');
      }
      const photo = ctx.message.photo.at(-1).file_id;
      db.previews.push(photo);
      saveDB(db);
      await ctx.reply('✅ Regular preview saved (' + db.previews.length + '/20)');
    }
  } catch (e) {
    console.error('Admin handler error:', e);
  }
});

// ─── Verify TON payment ─────────────────────────────────────────────────────

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

    let inviteLink = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const link = await ctx.telegram.createChatInviteLink(CHANNEL_ID, {
          member_limit: 1
        });
        inviteLink = link.invite_link;
        break;
      } catch (e) {
        console.error(`Invite link attempt ${attempt} failed:`, e.message);
        if (attempt < 3) await new Promise(r => setTimeout(r, 1500));
      }
    }

    if (inviteLink) {
      await ctx.reply(
        '🎉 Payment confirmed! Welcome!\n\n👉 Your invite link:\n' + inviteLink + '\n\n⚠️ Single use only — do not share it!'
      );
    } else {
      await ctx.reply(
        '✅ Payment confirmed!\n\n⚠️ There was a problem generating your invite link. Please wait — you will receive it shortly.'
      );
      try {
        await bot.telegram.sendMessage(
          ADMIN_ID,
          `⚠️ Failed to generate invite link for user ${userId}.\nPlease send them a manual invite link to the channel.`
        );
      } catch (adminErr) {
        console.error('Failed to notify admin:', adminErr.message);
      }
    }
  } catch (e) {
    console.error('Verify error:', e);
  }
});

// ─── TON payment check ──────────────────────────────────────────────────────

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

// ─── Express + launch ───────────────────────────────────────────────────────

app.get('/', (req, res) => res.send('Bot is running ✅'));

app.listen(process.env.PORT || 3000, () => {
  console.log('Server running');
});

bot.launch();
console.log('Bot running');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));