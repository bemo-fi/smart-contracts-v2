import {Address, toNano} from '@ton/core'
import {NetworkProvider} from '@ton/blueprint'
import {NominatorPool} from "../wrappers/NominatorPool";
import {TransactionMultisig} from "../wrappers/TransactionMultisig";

export async function run(provider: NetworkProvider) {

    const transactionMultisig = provider.open(TransactionMultisig.createFromAddress(Address.parse("EQC7vy1mW_wPJPbbEAfWcOd-DNV66YYJb8vYJPpoplZUmlTr")))

    const poolCode = await transactionMultisig.getPoolCode()

    const nominatorPool = provider.open(NominatorPool.createFromConfig({
        maxNominatorsCount: 40,
        minNominatorStake: 100000,
        minValidatorStake: 1001,
        validatorAddress: "Ef-H2YtJe0FQuXXN8QsY_-fggtXo74WaERkJNQjXAhN9cHk3",
        validatorRewardPercent: 10
    }, poolCode, -1));

    console.log('---------------------------------');
    console.log('NOMINATOR POOL ADDRESS:', nominatorPool.address.toString())
    console.log('---------------------------------');

    await nominatorPool.sendDeploy(provider.sender(), toNano('1'));

    await provider.waitForDeploy(nominatorPool.address);
}
