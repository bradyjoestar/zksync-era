/**
 * This suite contains tests checking our handling of Ether (such as depositing, checking `msg.value`, etc).
 */

import { TestMaster } from '../src/index';
import { shouldChangeETHBalances, shouldOnlyTakeFee } from '../src/modifiers/balance-checker';
import { checkReceipt } from '../src/modifiers/receipt-check';

import * as zksync from 'zksync-web3';
import { BigNumber } from 'ethers';
import { scaledGasPrice } from '../src/helpers';

const ETH_ADDRESS = zksync.utils.ETH_ADDRESS;

describe('ETH token checks', () => {
    let testMaster: TestMaster;
    let alice: zksync.Wallet;
    let bob: zksync.Wallet;

    beforeAll(() => {
        testMaster = TestMaster.getInstance(__filename);
        alice = testMaster.mainAccount();
        bob = testMaster.newEmptyAccount();
    });

    test('Can perform a deposit', async () => {
        const amount = 1; // 1 wei is enough.
        const gasPrice = scaledGasPrice(alice);

        // Unfortunately, since fee is taken in ETH, we must calculate the L1 ETH balance diff explicitly.
        const l1EthBalanceBefore = await alice.getBalanceL1();
        // No need to check fee as the L1->L2 are free for now
        const l2ethBalanceChange = await shouldChangeETHBalances([{ wallet: alice, change: amount }], {
            l1ToL2: true
        });

        const l2GasLimit = await zksync.utils.estimateDefaultBridgeDepositL2Gas(
            alice.providerL1!,
            alice.provider,
            ETH_ADDRESS,
            amount,
            alice.address,
            alice.address
        );
        const gasPerPubdataByte = zksync.utils.REQUIRED_L1_TO_L2_GAS_PER_PUBDATA_LIMIT;
        const expectedL2Costs = await alice.getBaseCost({
            gasLimit: l2GasLimit,
            gasPerPubdataByte,
            gasPrice: await gasPrice
        });

        const depositOp = alice.deposit({
            token: ETH_ADDRESS,
            amount,
            gasPerPubdataByte,
            l2GasLimit,
            overrides: {
                gasPrice
            }
        });
        await expect(depositOp).toBeAccepted([l2ethBalanceChange]);

        const depositFee = await depositOp
            .then((op) => op.waitL1Commit())
            .then(async (receipt) => {
                const l1GasFee = receipt.gasUsed.mul(receipt.effectiveGasPrice);
                return l1GasFee.add(expectedL2Costs);
            });
        const l1EthBalanceAfter = await alice.getBalanceL1();
        expect(l1EthBalanceBefore.sub(depositFee).sub(l1EthBalanceAfter)).bnToBeEq(amount);
    });

    test('Can perform a transfer (legacy)', async () => {
        const LEGACY_TX_TYPE = 0;
        const value = BigNumber.from(200);

        const ethBalanceChange = await shouldChangeETHBalances([
            { wallet: alice, change: -value },
            { wallet: bob, change: value }
        ]);
        const correctReceiptType = checkReceipt(
            (receipt) => receipt.type == LEGACY_TX_TYPE,
            'Incorrect tx type in receipt'
        );

        await expect(alice.sendTransaction({ type: LEGACY_TX_TYPE, to: bob.address, value })).toBeAccepted([
            ethBalanceChange,
            correctReceiptType
        ]);
    });

    test('Can perform a transfer (EIP712)', async () => {
        const value = BigNumber.from(200);

        const ethBalanceChange = await shouldChangeETHBalances([
            { wallet: alice, change: -value },
            { wallet: bob, change: value }
        ]);
        const correctReceiptType = checkReceipt(
            (receipt) => receipt.type == zksync.utils.EIP712_TX_TYPE,
            'Incorrect tx type in receipt'
        );

        await expect(alice.sendTransaction({ type: zksync.utils.EIP712_TX_TYPE, to: bob.address, value })).toBeAccepted(
            [ethBalanceChange, correctReceiptType]
        );
    });

    test('Can perform a transfer (EIP1559)', async () => {
        const EIP1559_TX_TYPE = 2;
        const value = BigNumber.from(200);

        const ethBalanceChange = await shouldChangeETHBalances([
            { wallet: alice, change: -value },
            { wallet: bob, change: value }
        ]);
        const correctReceiptType = checkReceipt(
            (receipt) => receipt.type == EIP1559_TX_TYPE,
            'Incorrect tx type in receipt'
        );

        await expect(alice.sendTransaction({ type: EIP1559_TX_TYPE, to: bob.address, value })).toBeAccepted([
            ethBalanceChange,
            correctReceiptType
        ]);
    });

    test('Should reject transactions with access lists', async () => {
        const EIP_2930_TX_TYPE = 0x01;
        const EIP_1559_TX_TYPE = 0x02;
        const value = BigNumber.from(200);

        await expect(alice.sendTransaction({ type: EIP_2930_TX_TYPE, to: bob.address, value })).toBeRejected(
            'access lists are not supported'
        );

        await expect(
            alice.sendTransaction({
                type: EIP_1559_TX_TYPE,
                to: bob.address,
                value,
                accessList: [{ address: '0x0000000000000000000000000000000000000000', storageKeys: [] }]
            })
        ).toBeRejected('access lists are not supported');
    });

    test('Can perform a transfer to self', async () => {
        const value = BigNumber.from(200);

        // Balance should not change, only fee should be taken.
        const ethBalanceChange = await shouldOnlyTakeFee(alice);
        await expect(alice.sendTransaction({ to: alice.address, value })).toBeAccepted([ethBalanceChange]);
    });

    test('Incorrect transfer should revert', async () => {
        // Attempt to transfer the whole Alice balance: there would be no enough balance to cover the fee.
        const value = await alice.getBalance();

        // Since gas estimation is expected to fail, we request gas limit for similar non-failing tx.
        const gasLimit = await alice.estimateGas({ to: bob.address, value: 1 });

        // Send transfer, it should be rejected due to lack of balance.
        await expect(alice.sendTransaction({ to: bob.address, value, gasLimit })).toBeRejected(
            'insufficient funds for gas + value.'
        );
    });

    test('Can perform a withdrawal', async () => {
        if (testMaster.isFastMode()) {
            return;
        }
        const amount = 1;

        const l2ethBalanceChange = await shouldChangeETHBalances([{ wallet: alice, change: -amount }]);
        const withdrawalPromise = alice.withdraw({ token: ETH_ADDRESS, amount });
        await expect(withdrawalPromise).toBeAccepted([l2ethBalanceChange]);
        const withdrawalTx = await withdrawalPromise;
        await withdrawalTx.waitFinalize();

        await expect(alice.finalizeWithdrawal(withdrawalTx.hash)).toBeAccepted();
    });

    afterAll(async () => {
        await testMaster.deinitialize();
    });
});
