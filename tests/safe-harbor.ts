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
  const taker = anchor.web3.Keypair.generate();

  let mintA: anchor.web3.PublicKey;
  let mintB: anchor.web3.PublicKey;

  let makerAtaA: anchor.web3.PublicKey;
  let makerAtaB: anchor.web3.PublicKey;

  let takerAtaA: anchor.web3.PublicKey;
  let takerAtaB: anchor.web3.PublicKey;

  let vault: anchor.web3.PublicKey;

  const seed = new BN(64)

  const escrowPDA = anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from("escrow"), provider.publicKey.toBuffer(),
      Buffer.from(seed.toArrayLike(Buffer, "le", 8)),
    ],
    program.programId
  )[0];

  const maker_deposit_amount = 100000000;
  const escrow_receive_amount = 1500000000;


  it("Request airdrop to taker.", async () => {
     const signature = await provider.connection.requestAirdrop(taker.publicKey, 10000000000);
     await provider.connection.confirmTransaction(signature);
     console.log("\nAirdrop to taker successful - Signature", signature);
  });

  it("Create mint accounts and mint to maker and taker.", async () => {
    mintA = await createMint(provider.connection, maker.payer, provider.publicKey, provider.publicKey, 6);
    console.log("\nmintA", mintA.toBase58());

    mintB = await createMint(provider.connection, maker.payer, provider.publicKey, provider.publicKey, 6);
    console.log("mintB", mintB.toBase58());

    vault = getAssociatedTokenAddressSync(mintA, escrowPDA, true);

    makerAtaA = (await getOrCreateAssociatedTokenAccount(provider.connection, maker.payer, mintA, provider.publicKey)).address;
    makerAtaB = (await getOrCreateAssociatedTokenAccount(provider.connection, maker.payer, mintB, provider.publicKey)).address; 
    
    takerAtaA = (await getOrCreateAssociatedTokenAccount(provider.connection, maker.payer, mintA, taker.publicKey)).address;
    takerAtaB = (await getOrCreateAssociatedTokenAccount(provider.connection, maker.payer, mintB, taker.publicKey)).address

    await mintTo(provider.connection, maker.payer, mintA, makerAtaA, maker.payer, maker_deposit_amount);
    console.log("Tokens minted to maker ata A for deposit", makerAtaA.toBase58());
    
    await mintTo(provider.connection, maker.payer, mintB, takerAtaB, maker.payer, escrow_receive_amount);
    console.log("Tokens minted to taker ata B for deposit\n", takerAtaB.toBase58());
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

});
