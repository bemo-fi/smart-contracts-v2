import {toNano} from '@ton/core'
import {JettonWallet} from '../wrappers/JettonWallet'
import {compile, NetworkProvider} from '@ton/blueprint'

export async function run(provider: NetworkProvider) {
    const jettonWallet = provider.open(JettonWallet.createFromConfig({
        balance: 0,
        jettonMasterAddress: "",
        ownerAddress: ""
    }, await compile('JettonWallet')));

    console.log('---------------------------------');
    console.log('JETTON WALLET ADDRESS:', jettonWallet.address.toString())
    console.log('---------------------------------');

    await jettonWallet.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(jettonWallet.address);
}
