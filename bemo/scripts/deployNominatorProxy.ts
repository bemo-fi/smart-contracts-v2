import {Address, toNano} from '@ton/core'
import {NominatorProxy} from '../wrappers/NominatorProxy'
import {NetworkProvider} from '@ton/blueprint'
import {TransactionMultisig} from "../wrappers/TransactionMultisig";

export async function run(provider: NetworkProvider) {

    const transactionMultisig = provider.open(TransactionMultisig.createFromAddress(Address.parse("EQC7vy1mW_wPJPbbEAfWcOd-DNV66YYJb8vYJPpoplZUmlTr")))

    const proxyCode = await transactionMultisig.getProxyCode()

    const proxy = provider.open(NominatorProxy.createFromConfig({
        financialAddress: "EQDNhy-nxYFgUqzfUzImBEP67JqsyMIcyk2S5_RwNNEYku0k",
        nominatorPoolAddress: "Ef8nWRW8IV7riENJ2GzVoErKNNjWSPM1LaJkY8ya8EsoLuqI"
    }, proxyCode));

    console.log('---------------------------------');
    console.log('NOMINATOR PROXY ADDRESS:', proxy.address.toString())
    console.log('---------------------------------');

    await proxy.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(proxy.address);

    console.log(await proxy.getProxyData())
}
