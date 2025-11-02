import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SafeHarbor } from "../target/types/safe_harbor";
import { BN } from "bn.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { ASSOCIATED_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";
import { expect } from "chai";

describe("safe-passage", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env()
  anchor.setProvider(provider);

  const program = anchor.workspace.SafeHarbor as Program<SafeHarbor>;

  const maker = provider.wallet;
  const taker = anchor.web3.Keypair.fromSeed(
    Uint8Array.from(Buffer.from("CQB35H179dvx8ADpLUiWkf45XWfydGMF"))
  );

  let mintA: anchor.web3.PublicKey;
  let mintB: anchor.web3.PublicKey;

  let makerAtaA: anchor.web3.PublicKey;
  let makerAtaB: anchor.web3.PublicKey;

  let takerAtaA: anchor.web3.PublicKey;
  let takerAtaB: anchor.web3.PublicKey;

  let vault: anchor.web3.PublicKey;

  const seed = new BN(66)

  const escrowPDA = anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from("escrow"), provider.publicKey.toBuffer(),
      Buffer.from(seed.toArrayLike(Buffer, "le", 8)),
    ],
    program.programId
  )[0];

  const maker_deposit_amount = 1_000_000_000;
  const escrow_receive_amount = 1_500_000_000;


  it("Request airdrop to taker.", async () => {
     const signature = await provider.connection.requestAirdrop(taker.publicKey, 1_000_000_000);
     await provider.connection.confirmTransaction(signature);
     console.log("\nAirdrop to taker successful - Signature", signature);
  });

  it("Create mint accounts and mint to maker and taker.", async () => {
    mintA = await createMint(provider.connection, maker.payer, provider.publicKey, provider.publicKey, 9);
    console.log("\nmintA", mintA.toBase58());

    mintB = await createMint(provider.connection, maker.payer, provider.publicKey, provider.publicKey, 9);
    console.log("mintB", mintB.toBase58());

    vault = getAssociatedTokenAddressSync(mintA, escrowPDA, true);

    makerAtaA = (await getOrCreateAssociatedTokenAccount(provider.connection, maker.payer, mintA, provider.publicKey)).address;
    makerAtaB = (await getOrCreateAssociatedTokenAccount(provider.connection, maker.payer, mintB, provider.publicKey)).address; 
    
    takerAtaA = (await getOrCreateAssociatedTokenAccount(provider.connection, maker.payer, mintA, taker.publicKey)).address;
    takerAtaB = (await getOrCreateAssociatedTokenAccount(provider.connection, maker.payer, mintB, taker.publicKey)).address

    await mintTo(provider.connection, maker.payer, mintA, makerAtaA, maker.payer, maker_deposit_amount);
    console.log("Tokens minted to maker ata A for deposit", makerAtaA.toBase58());
    
    await mintTo(provider.connection, maker.payer, mintB, takerAtaB, maker.payer, escrow_receive_amount);
    console.log("Tokens minted to taker ata B for deposit", takerAtaB.toBase58());
  });

  it("Initialized escrow and deposit", async () => {
    const maker_initial_balance = (await provider.connection.getTokenAccountBalance(makerAtaA)).value;

    const tx = await program.methods.make(seed,new BN(escrow_receive_amount), new BN(maker_deposit_amount))
    .accountsPartial({
      maker: maker.publicKey,
      mintA: mintA,
      mintB: mintB,
      makerAtaA: makerAtaA,
      escrow: escrowPDA,
      vault:vault,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
    console.log("Your transaction signature", tx);

    const escrow_acc = await program.account.escrow.fetch(escrowPDA);
    const vault_token = (await provider.connection.getTokenAccountBalance(vault)).value;
    const maker_final_balance = (await provider.connection.getTokenAccountBalance(makerAtaA)).value;

    expect(escrow_acc.seed.toNumber()).to.equal(seed.toNumber());
    expect(escrow_acc.maker.toString()).to.equal(maker.publicKey.toString());
    expect(escrow_acc.mintA.toString()).to.equal(mintA.toString());
    expect(escrow_acc.mintB.toString()).to.equal(mintB.toString());
    expect(escrow_acc.receive.toNumber()).to.equal(escrow_receive_amount);

    // check balances
    expect(Number(vault_token.amount)).to.equal(maker_deposit_amount);
    expect(
      Number(maker_final_balance.amount))
      .to.equal(Number(maker_initial_balance.amount) - maker_deposit_amount);
  });

  it("Refund maker and close escrow and vault.", async () => {
    const maker_initial_balance = (await provider.connection.getAccountInfo(maker.publicKey)).lamports;
    const maker_initial_mint_a_balance = (await provider.connection.getTokenAccountBalance(makerAtaA)).value;
    const escrow_initial_lamports = (await provider.connection.getAccountInfo(escrowPDA)).lamports;
    const vault_initial_lamports = (await provider.connection.getAccountInfo(vault)).lamports;

    const tx = await program.methods.refund()
    .accountsPartial({
      maker: maker.publicKey,
      mintA: mintA,
      makerAtaA: makerAtaA,
      escrow: escrowPDA,
      vault:vault,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
    console.log("Your transaction signature", tx);
    await provider.connection.confirmTransaction(tx, "confirmed");

    const txDetails = await provider.connection.getTransaction(tx, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0
    });
  
    const tx_fee = txDetails.meta.fee;

    const escrow_acc = await program.account.escrow.getAccountInfo(escrowPDA);
    const vault_acc = await provider.connection.getAccountInfo(vault);
    const maker_final_balance = (await provider.connection.getAccountInfo(maker.publicKey)).lamports;
    const maker_final_mint_a_balance = (await provider.connection.getTokenAccountBalance(makerAtaA)).value;

    expect(escrow_acc).to.be.null;
    expect(vault_acc).to.be.null;

    // Check balances
    expect(
      Number(maker_final_mint_a_balance.amount))
      .to.equal(Number(maker_initial_mint_a_balance.amount) + maker_deposit_amount);
      
    // Check rent returned to maker
      expect(maker_final_balance).to.equal(
        maker_initial_balance + escrow_initial_lamports + vault_initial_lamports - tx_fee
      )
  });

  it("Taker deposit, withraw and close escrow and vault and return rent to maker.", async () => {
    const init_escrow_tx = await program.methods.make(seed, new BN(escrow_receive_amount), new BN(maker_deposit_amount))
    .accountsPartial({
      maker: maker.publicKey,
      mintA: mintA,
      mintB: mintB,
      makerAtaA: makerAtaA,
      escrow: escrowPDA,
      vault:vault,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
    await provider.connection.confirmTransaction(init_escrow_tx, "confirmed");

    const maker_initial_balance = (await provider.connection.getAccountInfo(maker.publicKey)).lamports;
    const maker_initial_mint_b_balance = (await provider.connection.getTokenAccountBalance(makerAtaB)).value;
    const taker_initial_mint_a_balance = (await provider.connection.getTokenAccountBalance(takerAtaA)).value;
    const escrow_initial_lamports = (await provider.connection.getAccountInfo(escrowPDA)).lamports;
    const vault_initial_lamports = (await provider.connection.getAccountInfo(vault)).lamports;

    const tx = await program.methods.take()
    .accountsPartial({
      taker: taker.publicKey,
      maker: maker.publicKey,
      mintA: mintA,
      mintB: mintB,
      makerAtaB: makerAtaB,
      takerAtaA: takerAtaA,
      takerAtaB: takerAtaB,
      escrow: escrowPDA,
      vault:vault,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .transaction();

    const signature = await anchor.web3.sendAndConfirmTransaction(
      provider.connection,
      tx,
      [taker]
    );

    console.log("Your transaction signature", signature);
    await provider.connection.confirmTransaction(signature, "confirmed");
  
    const escrow_acc = await program.account.escrow.getAccountInfo(escrowPDA);
    const vault_acc = await provider.connection.getAccountInfo(vault);
    const maker_final_balance = (await provider.connection.getAccountInfo(maker.publicKey)).lamports;
    const maker_final_mint_b_balance = (await provider.connection.getTokenAccountBalance(makerAtaB)).value;
    const taker_final_mint_a_balance = (await provider.connection.getTokenAccountBalance(takerAtaA)).value;

    expect(escrow_acc).to.be.null;
    expect(vault_acc).to.be.null;

    // Check balances
    expect(
      Number(maker_final_mint_b_balance.amount))
      .to.equal(Number(maker_initial_mint_b_balance.amount) + escrow_receive_amount);
    expect(
      Number(taker_final_mint_a_balance.amount))
      .to.equal(Number(taker_initial_mint_a_balance.amount) + maker_deposit_amount);
    expect(
      Number(taker_final_mint_a_balance.amount))
      .to.equal(Number(taker_initial_mint_a_balance.amount) + maker_deposit_amount);
        
    // Check rent returned to maker
    expect(maker_final_balance).to.equal(maker_initial_balance + escrow_initial_lamports + vault_initial_lamports)
  });
});