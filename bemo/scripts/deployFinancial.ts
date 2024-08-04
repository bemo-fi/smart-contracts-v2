import {toNano} from '@ton/core'
import {Financial} from '../wrappers/Financial'
import {compile, NetworkProvider} from '@ton/blueprint'

export async function run(provider: NetworkProvider) {
    const financial = provider.open(Financial.createFromConfig({
        unstakeRequestCode: await compile("UnstakeRequest"),
        transactionAdminAddress: "TRANSACTION MULTISIG ADDRESS",
        commissionAddress: "COMMISION ADDRESS",
        tonTotalSupply: 1,
        jettonTotalSupply: 1,
        commissionFactor: 15,
        content: {
            name: "Staking Ton Test Coin v4",
            description: "Staking Ton Test Coin",
            image: "https://i.pinimg.com/originals/bd/d3/ae/bdd3aed7ad4eaf5d7198a04760280c6a.jpg",
            symbol: "STTC4",
            decimals: "9"
        },
        adminAddress: "ADMIN MULTISIG ADDRESS",
        jettonWalletCode: await compile('JettonWallet')
    }, await compile('Financial'), 0));

    console.log('---------------------------------');
    console.log('FINANCIAL ADDRESS:', financial.address.toString())
    console.log('---------------------------------');

    await financial.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(financial.address);
}
