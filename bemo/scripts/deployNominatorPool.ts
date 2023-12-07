import {toNano} from 'ton-core'
import {compile, NetworkProvider} from '@ton-community/blueprint'
import {NominatorPool} from "../wrappers/NominatorPool";

export async function run(provider: NetworkProvider) {

    const nominatorPool = provider.open(NominatorPool.createFromConfig({
        maxNominatorsCount: 40,
        minNominatorStake: 10,
        minValidatorStake: 9,
        validatorAddress: "EQCEuIGH8I2bkAf8rLpuxkWmDJ_xZedEHDvjs6aCAN2FrkFp",
        validatorRewardPercent: 40
    }, await compile('nominatorPool'), -1));

    await nominatorPool.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(nominatorPool.address);

    // run methods on `nominatorProxy`
}
