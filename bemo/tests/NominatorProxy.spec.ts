import {Blockchain, SandboxContract, TreasuryContract} from '@ton-community/sandbox'
import {Address, beginCell, Cell, fromNano, toNano} from 'ton-core'
import {NominatorProxy, NominatorProxyErrors} from '../wrappers/NominatorProxy'
import '@ton-community/test-utils'
import {compile} from '@ton-community/blueprint'
import now = jest.now;
import {NominatorPool} from "../wrappers/NominatorPool";

describe('NominatorProxy', () => {
    let code: Cell
    let nominatorPoolCode: Cell
    let blockchain: Blockchain
    let nominatorProxy: SandboxContract<NominatorProxy>
    let financial: SandboxContract<TreasuryContract>
    let nominatorPool: SandboxContract<TreasuryContract>

    beforeAll(async () => {
        code = await compile('NominatorProxy')
        nominatorPoolCode = await compile('NominatorPool')
    })

    beforeEach(async () => {
        blockchain = await Blockchain.create()

        financial = await blockchain.treasury('financial')
        nominatorPool = await blockchain.treasury('nominatorPool', {workchain: -1})

        nominatorProxy = blockchain.openContract(await NominatorProxy.createFromConfig({
            depositAmount: 0,
            depositTime: 0,
            withdrawnTime: 0,
            financialAddress: financial.address.toString(),
            nominatorPoolAddress: nominatorPool.address.toString()
        }, code))

        const deployer = await blockchain.treasury('deployer')
        const deployResult = await nominatorProxy.sendDeploy(deployer.getSender(), toNano('0.05'))

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: nominatorProxy.address,
            deploy: true,
        })

        const proxyData = await nominatorProxy.getProxyData()

        expect(proxyData).toStrictEqual({
            walletId: 0,
            depositAmount: 0,
            depositTime: 0,
            withdrawnTime: 0,
            financialAddress: financial.address.toString(),
            nominatorPoolAddress: nominatorPool.address.toString(),
            lastWithdrawAddress: undefined
        })
    })

    it('[from financial] when error is thrown or the pool is not deployed, message should bounce back and deposit will not increase', async () => {
        const nominatorProxyWithNotDeployedPool = blockchain.openContract(await NominatorProxy.createFromConfig({
            depositAmount: 0,
            financialAddress: financial.address.toString(),
            nominatorPoolAddress: 'EQAJH62UImgdvXk-Bxy9zcbRm6xDkGsREqGRYyJIsFOp0jSZ'
        }, code))

        const newDeployer = await blockchain.treasury('newDeployer')
        const newDeployResult = await nominatorProxyWithNotDeployedPool.sendDeploy(newDeployer.getSender(), toNano('0.05'))
        expect(newDeployResult.transactions).toHaveTransaction({
            from: newDeployer.address,
            to: nominatorProxyWithNotDeployedPool.address,
            deploy: true,
        })

        const initialProxyData = await nominatorProxyWithNotDeployedPool.getProxyData()
        expect(initialProxyData.depositAmount).toBe(0)

        const result = await nominatorProxyWithNotDeployedPool.sendTonToNominatorProxy(financial.getSender(), toNano(20001))
        expect(result.transactions.length).toBe(5)

        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: nominatorProxyWithNotDeployedPool.address,
            value: toNano(20001),
            exitCode: NominatorProxyErrors.noErrors,
            success: true,
        })

        expect(result.transactions).toHaveTransaction({
            from: nominatorProxyWithNotDeployedPool.address,
            to: Address.parse('EQAJH62UImgdvXk-Bxy9zcbRm6xDkGsREqGRYyJIsFOp0jSZ'),
            value: (x) => {
                return x! > toNano(10001)
            },
            body: beginCell().storeUint(0, 32).storeUint(100, 8).endCell(),
            success: false,
            aborted: true
        })

        expect(result.transactions).toHaveTransaction({
            from: Address.parse('EQAJH62UImgdvXk-Bxy9zcbRm6xDkGsREqGRYyJIsFOp0jSZ'),
            to: nominatorProxyWithNotDeployedPool.address,
            value: (x) => {
                return x! > toNano(10001)
            },
            body: beginCell().storeUint(0xFFFFFFFF, 32).storeUint(0, 32).storeUint(100, 8).endCell(),
            exitCode: NominatorProxyErrors.noErrors,
            success: true
        })

        expect(result.transactions).toHaveTransaction({
            from: nominatorProxyWithNotDeployedPool.address,
            to: financial.address,
            value: (x) => {
                return x! >= toNano(10001)
            },
            body: beginCell().storeUint(9, 32).endCell(),
            exitCode: NominatorProxyErrors.noErrors,
            success: true
        })

        const proxyData = await nominatorProxyWithNotDeployedPool.getProxyData()
        expect(proxyData.depositAmount).toBe(0)
    })

    it('[from financial] should throw error if amount of ton < 10.001', async () => {
        const initialProxyData = await nominatorProxy.getProxyData()
        const result = await nominatorProxy.sendTonToNominatorProxy(financial.getSender(), toNano(1))
        expect(result.transactions.length).toBe(3)
        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: nominatorProxy.address,
            value: toNano('1'),
            exitCode: NominatorProxyErrors.insufficientBalance
        })
        expect(result.transactions).toHaveTransaction({
            from: nominatorProxy.address,
            to: financial.address,
            value: x => {
                return x! < toNano('1')
            },
            exitCode: NominatorProxyErrors.noErrors
        })

        const proxyData = await nominatorProxy.getProxyData();
        expect(proxyData.depositAmount).toBe(0)
        expect(proxyData.depositAmount).toBe(initialProxyData.depositAmount)
    })

    it('[from financial] should receive, save deposit and send to pool', async () => {
        const result = await nominatorProxy.sendTonToNominatorProxy(financial.getSender(), toNano(20001))
        const depositTime = result.transactions[2].now

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: nominatorProxy.address,
            value: toNano('20001'),
            exitCode: NominatorProxyErrors.noErrors
        })

        expect(result.transactions).toHaveTransaction({
            from: nominatorProxy.address,
            to: nominatorPool.address,
            value: (x) => {
                return x! >= toNano(10001)
            },
            body: beginCell().storeUint(0, 32).storeUint(100, 8).endCell()
        })

        const proxyData = await nominatorProxy.getProxyData()
        expect(proxyData.depositAmount).toBeCloseTo(20001, 1)
        expect(proxyData.depositTime).toBeCloseTo(depositTime)
    })

    it('[from financial] should thrown an error if deposited twice', async () => {
        await nominatorProxy.sendTonToNominatorProxy(financial.getSender(), toNano(20001))
        const initialProxyData = await nominatorProxy.getProxyData()
        const result = await nominatorProxy.sendTonToNominatorProxy(financial.getSender(), toNano(20001))

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction(
            {
                from: financial.address,
                to: nominatorProxy.address,
                value: toNano('20001'),
                success: false,
                exitCode: NominatorProxyErrors.depositHasAlreadyBeenMade
            }
        )

        expect(result.transactions).toHaveTransaction(
            {
                from: nominatorProxy.address,
                to: financial.address,
                value:(x) => {
                    return x! >= toNano(20000) && x! <= toNano(20001)
                },
                success: true,
                exitCode: NominatorProxyErrors.noErrors
            }
        )

        const proxyData = await nominatorProxy.getProxyData()
        expect(proxyData.depositAmount).toBeCloseTo(initialProxyData.depositAmount!, 1)
        expect(proxyData.depositTime).toBe(initialProxyData.depositTime)
    })

    it('[from anyone] should throw an error because 10 hours have not passed', async () => {
        const depositTime = Math.floor(now() / 1000) // now
        await nominatorProxy.sendTonToNominatorProxy(financial.getSender(), toNano(20001))
        const initialProxyData = await nominatorProxy.getProxyData()
        expect(initialProxyData.depositTime).toBe(depositTime)

        const anyone = await blockchain.treasury('anyone')
        const tonAmount = toNano(2)
        const result = await nominatorProxy.sendTonToNominatorProxy(anyone.getSender(), tonAmount)

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: nominatorProxy.address,
            value: tonAmount,
            success: false,
            exitCode: NominatorProxyErrors.withdrawTimeHasNotYetCome
        })

        expect(result.transactions).toHaveTransaction({
            from: nominatorProxy.address,
            to: anyone.address,
            value: (x) => {
                return x! < tonAmount
            },
            success: true
        })

        const proxyData = await nominatorProxy.getProxyData()
        expect(proxyData.withdrawnTime).toBe(0)
        expect(proxyData.lastWithdrawAddress).toBe(undefined)
    })

    it('[from anyone] should throw an error as there is no deposit', async () => {
        const initialProxyData = await nominatorProxy.getProxyData()
        expect(initialProxyData.depositTime).toBe(0)
        expect(initialProxyData.depositAmount).toBe(0)

        const anyone = await blockchain.treasury('anyone')
        const tonAmount = toNano(2)
        const result = await nominatorProxy.sendTonToNominatorProxy(anyone.getSender(), tonAmount)

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: nominatorProxy.address,
            value: tonAmount,
            success: false,
            exitCode: NominatorProxyErrors.notDeposited
        })

        expect(result.transactions).toHaveTransaction({
            from: nominatorProxy.address,
            to: anyone.address,
            value: (x) => {
                return x! < tonAmount
            },
            success: true
        })

        const proxyData = await nominatorProxy.getProxyData()
        expect(proxyData.withdrawnTime).toBe(0)
        expect(proxyData.lastWithdrawAddress).toBe(undefined)
    })

    it('[from anyone] should throw an error as not enough ton have been sent', async () => {
        await nominatorProxy.sendTonToNominatorProxy(financial.getSender(), toNano(20001))

        const anyone = await blockchain.treasury('anyone')
        const tonAmount = toNano(3) / 10n
        const result = await nominatorProxy.sendTonToNominatorProxy(anyone.getSender(), tonAmount)

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: nominatorProxy.address,
            value: tonAmount,
            success: false,
            exitCode: NominatorProxyErrors.insufficientBalance
        })

        expect(result.transactions).toHaveTransaction({
            from: nominatorProxy.address,
            to: anyone.address,
            value: (x) => {
                return x! < tonAmount
            },
            success: true
        })

        const proxyData = await nominatorProxy.getProxyData()
        expect(proxyData.withdrawnTime).toBe(0)
        expect(proxyData.lastWithdrawAddress).toBe(undefined)
    })

    it('[from anyone] should throw an error because more ton were sent than needed', async () => {
        await nominatorProxy.sendTonToNominatorProxy(financial.getSender(), toNano(20001))

        const anyone = await blockchain.treasury('anyone')
        const tonAmount = toNano(3)
        const result = await nominatorProxy.sendTonToNominatorProxy(anyone.getSender(), tonAmount)

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: nominatorProxy.address,
            value: tonAmount,
            success: false,
            exitCode: NominatorProxyErrors.excessMsgValue
        })

        expect(result.transactions).toHaveTransaction({
            from: nominatorProxy.address,
            to: anyone.address,
            value: (x) => {
                return x! < tonAmount
            },
            success: true
        })

        const proxyData = await nominatorProxy.getProxyData()
        expect(proxyData.withdrawnTime).toBe(0)
        expect(proxyData.lastWithdrawAddress).toBe(undefined)
    })

    it('[from anyone] should pass without errors and request should be sent to pool for withdrawal', async () => {
        const depositTime = Math.floor(now() / 1000) - 60 * 60 * 10 // now - 10 hours
        const nominatorProxy1 = blockchain.openContract(await NominatorProxy.createFromConfig({
            depositAmount: 20000,
            depositTime: depositTime,
            financialAddress: financial.address.toString(),
            nominatorPoolAddress: nominatorPool.address.toString()
        }, code))

        const deployer1 = await blockchain.treasury('deployer1')
        const deployResult1 = await nominatorProxy1.sendDeploy(deployer1.getSender(), toNano('0.05'))

        expect(deployResult1.transactions).toHaveTransaction({
            from: deployer1.address,
            to: nominatorProxy1.address,
            deploy: true,
        })

        const initialProxyData = await nominatorProxy1.getProxyData()
        expect(initialProxyData.depositTime).toBe(depositTime)
        expect(initialProxyData.withdrawnTime).toBe(0)

        const anyone = await blockchain.treasury('anyone')
        const tonAmount = toNano(2)
        const result = await nominatorProxy1.sendTonToNominatorProxy(anyone.getSender(), tonAmount)

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: nominatorProxy1.address,
            value: tonAmount,
            success: true
        })

        expect(result.transactions).toHaveTransaction({
            from: nominatorProxy1.address,
            to: nominatorPool.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true,
            body: beginCell().storeUint(0, 32).storeUint(119, 8).endCell()
        })

        const proxyData = await nominatorProxy1.getProxyData()
        expect(proxyData.withdrawnTime).toBeGreaterThan(0)
        expect(proxyData.lastWithdrawAddress).toBe(anyone.address.toString())
    })

    it('[from anyone (real pool)] should pass without errors and request should be sent msg to pool for withdrawal', async () => {
        const pool = blockchain.openContract(NominatorPool.createFromConfig({
            maxNominatorsCount: 40,
            minNominatorStake: 10,
            minValidatorStake: 9,
            validatorAddress: nominatorPool.address.toString(),
            validatorRewardPercent: 40
        }, nominatorPoolCode, -1))

        const nominatorProxy1 = blockchain.openContract(await NominatorProxy.createFromConfig({
            depositAmount: 0,
            depositTime: 0,
            financialAddress: financial.address.toString(),
            nominatorPoolAddress: pool.address.toString()
        }, code))

        const deployer1 = await blockchain.treasury('deployer1')
        const deployResult1 = await nominatorProxy1.sendDeploy(deployer1.getSender(), toNano('0.05'))

        expect(deployResult1.transactions).toHaveTransaction({
            from: deployer1.address,
            to: nominatorProxy1.address,
            deploy: true,
        })

        const deployResult2 = await pool.sendDeploy(deployer1.getSender(), toNano('0.05'))

        expect(deployResult2.transactions).toHaveTransaction({
            from: deployer1.address,
            to: pool.address,
            deploy: true,
        })

        const depositAmount = toNano(20001)
        const depositTime = Math.floor(now() / 1000)
        blockchain.now = depositTime
        await nominatorProxy1.sendTonToNominatorProxy(financial.getSender(), depositAmount)
        const initialProxyData = await nominatorProxy1.getProxyData()
        expect(initialProxyData.depositAmount).toBeCloseTo(Number(fromNano(depositAmount)), 1)
        expect(initialProxyData.depositTime).toBe(depositTime)
        expect(initialProxyData.withdrawnTime).toBe(0)

        const anyone = await blockchain.treasury('anyone')

        blockchain.now = blockchain.now + 20 * 60 * 60
        await pool.sendValidatorDeposit(nominatorPool.getSender(), toNano("100"))
        const withdrawTime = blockchain.now

        const tonAmount = toNano(1)
        const result = await nominatorProxy1.sendTonToNominatorProxy(anyone.getSender(), tonAmount)

        expect(result.transactions.length).toBe(7)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: nominatorProxy1.address,
            value: tonAmount,
            success: true
        })

        expect(result.transactions).toHaveTransaction({
            from: nominatorProxy1.address,
            to: pool.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true,
            body: beginCell().storeUint(0, 32).storeUint(119, 8).endCell()
        })

        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: nominatorProxy1.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true
        })

        expect(result.transactions).toHaveTransaction({
            from: nominatorProxy1.address,
            to: financial.address,
            value: (x) => {
                return x! <= depositAmount
            },
            success: true
        })

        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: nominatorProxy1.address,
            value: (x) => {
                return x! >= tonAmount && x! <= depositAmount
            },
            success: true
        })

        expect(result.transactions).toHaveTransaction({
            from: nominatorProxy1.address,
            to: anyone.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true
        })

        const proxyData = await nominatorProxy1.getProxyData()
        expect(proxyData.withdrawnTime).toBe(withdrawTime)
        expect(proxyData.lastWithdrawAddress).toBe(undefined)
    })

    it('[from anyone] error should be thrown when withdraw is requested again and a 15 minutes has not passed', async () => {
        const depositTime = Math.floor(now() / 1000) - 60 * 60 * 10 // now - 10 hours
        const nominatorProxy1 = blockchain.openContract(await NominatorProxy.createFromConfig({
            depositAmount: 20000,
            depositTime: depositTime,
            financialAddress: financial.address.toString(),
            nominatorPoolAddress: nominatorPool.address.toString()
        }, code))

        const deployer1 = await blockchain.treasury('deployer1')
        const deployResult1 = await nominatorProxy1.sendDeploy(deployer1.getSender(), toNano('0.05'))

        expect(deployResult1.transactions).toHaveTransaction({
            from: deployer1.address,
            to: nominatorProxy1.address,
            deploy: true,
        })

        const initialProxyData = await nominatorProxy1.getProxyData()
        expect(initialProxyData.depositTime).toBe(depositTime)
        expect(initialProxyData.withdrawnTime).toBe(0)

        const anyone = await blockchain.treasury('anyone')
        const tonAmount = toNano(2)

        await nominatorProxy1.sendTonToNominatorProxy(anyone.getSender(), tonAmount)
        const withdrawTime = Math.floor(now() / 1000)

        const proxyData = await nominatorProxy1.getProxyData()
        expect(proxyData.withdrawnTime).toBe(withdrawTime)
        expect(proxyData.lastWithdrawAddress).toBe(anyone.address.toString())

        const result1 = await nominatorProxy1.sendTonToNominatorProxy(anyone.getSender(), tonAmount)

        expect(result1.transactions.length).toBe(3)

        expect(result1.transactions).toHaveTransaction({
            from: anyone.address,
            to: nominatorProxy1.address,
            value: tonAmount,
            success: false,
            exitCode: NominatorProxyErrors.withdrawHasAlreadyBeenMade
        })

        expect(result1.transactions).toHaveTransaction({
            from: nominatorProxy1.address,
            to: anyone.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true
        })

        const proxyData1 = await nominatorProxy1.getProxyData()
        expect(proxyData1.withdrawnTime).toBe(withdrawTime)
        expect(proxyData1.lastWithdrawAddress).toBe(anyone.address.toString())

        const anyone1 = await blockchain.treasury('anyone1')
        const result2 = await nominatorProxy1.sendTonToNominatorProxy(anyone1.getSender(), tonAmount)

        expect(result2.transactions.length).toBe(3)

        expect(result2.transactions).toHaveTransaction({
            from: anyone1.address,
            to: nominatorProxy1.address,
            value: tonAmount,
            success: false,
            exitCode: NominatorProxyErrors.withdrawHasAlreadyBeenMade
        })

        expect(result2.transactions).toHaveTransaction({
            from: nominatorProxy1.address,
            to: anyone1.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true
        })

        const proxyData2 = await nominatorProxy1.getProxyData()
        expect(proxyData2.withdrawnTime).toBe(withdrawTime)
        expect(proxyData2.lastWithdrawAddress).toBe(anyone.address.toString())
    })

    it('[from anyone] should send msg to pool for withdrawal when withdrawal was requested but a 15 minutes has passed', async () => {

        const anyone0 = await blockchain.treasury('anyone0')
        const depositTime = Math.floor(now() / 1000) - 60 * 60 * 10 // now - 10 hours
        const withdrawnTime = Math.floor(now() / 1000) - 15 * 60 // now - 15 minutes
        const nominatorProxy1 = blockchain.openContract(await NominatorProxy.createFromConfig({
            depositAmount: 20000,
            depositTime: depositTime,
            withdrawnTime: withdrawnTime,
            financialAddress: financial.address.toString(),
            lastWithdrawAddress: anyone0.address.toString(),
            nominatorPoolAddress: nominatorPool.address.toString()
        }, code))

        const deployer1 = await blockchain.treasury('deployer1')
        const deployResult1 = await nominatorProxy1.sendDeploy(deployer1.getSender(), toNano('0.05'))

        expect(deployResult1.transactions).toHaveTransaction({
            from: deployer1.address,
            to: nominatorProxy1.address,
            deploy: true,
        })

        const initialProxyData = await nominatorProxy1.getProxyData()
        expect(initialProxyData.depositTime).toBe(depositTime)
        expect(initialProxyData.withdrawnTime).toBe(withdrawnTime)
        expect(initialProxyData.lastWithdrawAddress).toBe(anyone0.address.toString())

        const anyone = await blockchain.treasury('anyone')
        const tonAmount = toNano(2)
        await nominatorProxy1.sendTonToNominatorProxy(anyone.getSender(), tonAmount)

        const proxyData = await nominatorProxy1.getProxyData()
        expect(proxyData.lastWithdrawAddress).toBe(anyone.address.toString())
    })

    it('[from anyone op 1] should send ton to financial', async () => {
        const anyone = await blockchain.treasury('anyone')
        const tonAmount = toNano(1)
        const result = await nominatorProxy.sendTonToFinancial(anyone.getSender(), tonAmount)

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: nominatorProxy.address,
            value: tonAmount,
            success: true
        })

        expect(result.transactions).toHaveTransaction({
            from: nominatorProxy.address,
            to: financial.address,
            success: true
        })
    })

    it('[from anyone op 1] should throw an error as there is not enough balance', async () => {
        const nominatorPool1 = await blockchain.treasury('nominatorPool1')
        const nominatorProxy1 = blockchain.openContract(await NominatorProxy.createFromConfig({
            depositAmount: 0,
            depositTime: 0,
            financialAddress: financial.address.toString(),
            nominatorPoolAddress: nominatorPool1.address.toString()
        }, code))

        const deployer1 = await blockchain.treasury('deployer1')
        const deployResult = await nominatorProxy1.sendDeploy(deployer1.getSender(), toNano('0.005'))

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer1.address,
            to: nominatorProxy1.address,
            deploy: true,
        })
        const anyone = await blockchain.treasury('anyone')
        const tonAmount = toNano(1) / 200n
        const result = await nominatorProxy1.sendTonToFinancial(anyone.getSender(), tonAmount)

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: nominatorProxy1.address,
            value: tonAmount,
            success: false,
            exitCode: NominatorProxyErrors.insufficientBalance
        })

        expect(result.transactions).toHaveTransaction({
            from: nominatorProxy1.address,
            to: anyone.address,
            value: (x) => {
                return x! < tonAmount
            },
            success: true
        })
    })

    it('[from nominator pool] should send ton to financial (with reward)', async () => {
        const deployer1 = await blockchain.treasury('deployer1')
        const depositTime = Math.floor(now() / 1000) - 60 * 60 * 10 // now - 10 hours
        const withdrawTime = Math.floor(now() / 1000) // now
        const nominatorProxy1 = blockchain.openContract(await NominatorProxy.createFromConfig({
            depositAmount: 20000,
            depositTime: depositTime,
            withdrawnTime: withdrawTime,
            financialAddress: financial.address.toString(),
            lastWithdrawAddress: deployer1.address.toString(),
            nominatorPoolAddress: nominatorPool.address.toString()
        }, code))

        const deployResult1 = await nominatorProxy1.sendDeploy(deployer1.getSender(), toNano('0.05'))

        expect(deployResult1.transactions).toHaveTransaction({
            from: deployer1.address,
            to: nominatorProxy1.address,
            deploy: true,
        })

        const initialProxyData = await nominatorProxy1.getProxyData()
        expect(initialProxyData.depositAmount).toBe(20000)
        expect(initialProxyData.depositTime).toBe(depositTime)
        expect(initialProxyData.withdrawnTime).toBe(withdrawTime)
        expect(initialProxyData.lastWithdrawAddress).toBe(deployer1.address.toString())

        const tonAmount = toNano(25000)
        const result = await nominatorProxy1.sendTonToNominatorProxy(nominatorPool.getSender(), tonAmount)
        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: nominatorPool.address,
            to: nominatorProxy1.address,
            value: tonAmount,
            success: true
        })

        expect(result.transactions).toHaveTransaction({
            from: nominatorProxy1.address,
            to: financial.address,
            value: (x) => {
                return x! <= tonAmount
            },
            body: (x) => {
                const op = x.beginParse().loadUint(32)
                const reward = x.beginParse().skip(32).loadCoins()
                return op == 1 && 0 < reward && reward <= tonAmount
            },
            success: true
        })

        const proxyData = await nominatorProxy1.getProxyData()
        expect(proxyData.depositAmount).toBe(0)
    })

    it('[from nominator pool] should send ton to financial (reward = 0)', async () => {
        const deployer1 = await blockchain.treasury('deployer1')
        const depositTime = Math.floor(now() / 1000) - 60 * 60 * 10 // now - 10 hours
        const withdrawTime = Math.floor(now() / 1000) // now
        const nominatorProxy1 = blockchain.openContract(await NominatorProxy.createFromConfig({
            depositAmount: 20000,
            depositTime: depositTime,
            withdrawnTime: withdrawTime,
            financialAddress: financial.address.toString(),
            lastWithdrawAddress: deployer1.address.toString(),
            nominatorPoolAddress: nominatorPool.address.toString()
        }, code))

        const deployResult1 = await nominatorProxy1.sendDeploy(deployer1.getSender(), toNano('0.05'))

        expect(deployResult1.transactions).toHaveTransaction({
            from: deployer1.address,
            to: nominatorProxy1.address,
            deploy: true,
        })

        const initialProxyData = await nominatorProxy1.getProxyData()
        expect(initialProxyData.depositAmount).toBe(20000)
        expect(initialProxyData.depositTime).toBe(depositTime)
        expect(initialProxyData.withdrawnTime).toBe(withdrawTime)
        expect(initialProxyData.lastWithdrawAddress).toBe(deployer1.address.toString())

        const tonAmount = toNano(20000)
        const result = await nominatorProxy1.sendTonToNominatorProxy(nominatorPool.getSender(), tonAmount)
        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: nominatorPool.address,
            to: nominatorProxy1.address,
            value: tonAmount,
            success: true
        })

        expect(result.transactions).toHaveTransaction({
            from: nominatorProxy1.address,
            to: financial.address,
            value: (x) => {
                return x! <= tonAmount
            },
            body: beginCell().storeUint(1, 32).storeCoins(0).endCell(),
            success: true
        })

        const proxyData = await nominatorProxy1.getProxyData()
        expect(proxyData.depositAmount).toBe(0)
    })

    it('[from nominator pool] should send ton to financial (not withdrawal)', async () => {
        const deployer1 = await blockchain.treasury('deployer1')
        const depositTime = Math.floor(now() / 1000) - 60 * 60 * 10 // now - 10 hours
        const nominatorProxy1 = blockchain.openContract(await NominatorProxy.createFromConfig({
            depositAmount: 20000,
            depositTime: depositTime,
            financialAddress: financial.address.toString(),
            nominatorPoolAddress: nominatorPool.address.toString()
        }, code))

        const deployResult1 = await nominatorProxy1.sendDeploy(deployer1.getSender(), toNano('0.05'))

        expect(deployResult1.transactions).toHaveTransaction({
            from: deployer1.address,
            to: nominatorProxy1.address,
            deploy: true,
        })

        const tonAmount = toNano(1)
        const result = await nominatorProxy1.sendTonToNominatorProxy(nominatorPool.getSender(), tonAmount)

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: nominatorPool.address,
            to: nominatorProxy1.address,
            value: tonAmount,
            success: true
        })

        expect(result.transactions).toHaveTransaction({
            from: nominatorProxy1.address,
            to: financial.address,
            value: (x) => {
                return x! <= tonAmount
            },
            body: beginCell().storeUint(9, 32).endCell(),
            success: true
        })

        const proxyData = await nominatorProxy1.getProxyData()
        expect(proxyData.depositAmount).toBe(20000)
        expect(proxyData.depositTime).toBe(depositTime)
    })

    it('[from nominator pool] should send ton to the last address that requested the withdrawal', async () => {
        const deployer1 = await blockchain.treasury('deployer1')
        const depositTime = Math.floor(now() / 1000) - 60 * 60 * 10 // now - 10 hours
        const withdrawTime = Math.floor(now() / 1000)// now
        const nominatorProxy1 = blockchain.openContract(await NominatorProxy.createFromConfig({
            depositAmount: 20000,
            depositTime: depositTime,
            withdrawnTime: withdrawTime,
            financialAddress: financial.address.toString(),
            lastWithdrawAddress: deployer1.address.toString(),
            nominatorPoolAddress: nominatorPool.address.toString()
        }, code))

        const deployResult1 = await nominatorProxy1.sendDeploy(deployer1.getSender(), toNano('0.05'))

        expect(deployResult1.transactions).toHaveTransaction({
            from: deployer1.address,
            to: nominatorProxy1.address,
            deploy: true,
        })

        const initialProxyData = await nominatorProxy1.getProxyData()
        expect(initialProxyData.depositAmount).toBe(20000)
        expect(initialProxyData.depositTime).toBe(depositTime)
        expect(initialProxyData.withdrawnTime).toBe(withdrawTime)
        expect(initialProxyData.lastWithdrawAddress).toBe(deployer1.address.toString())

        const tonAmount = toNano(1)
        const result = await nominatorProxy1.sendTonToNominatorProxy(nominatorPool.getSender(), tonAmount)
        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: nominatorPool.address,
            to: nominatorProxy1.address,
            value: tonAmount,
            success: true
        })

        expect(result.transactions).toHaveTransaction({
            from: nominatorProxy1.address,
            to: deployer1.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true
        })

        const proxyData = await nominatorProxy1.getProxyData()
        expect(proxyData.depositAmount).toBe(initialProxyData.depositAmount)
        expect(proxyData.depositTime).toBe(initialProxyData.depositTime)
        expect(proxyData.lastWithdrawAddress).toBe(undefined)
    })
})
