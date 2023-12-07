import {Address, toNano} from 'ton-core'
import {Financial} from '../wrappers/Financial'
import {compile, NetworkProvider} from '@ton-community/blueprint'

export async function run(provider: NetworkProvider) {

    // const fin = provider.open(Financial.createFromAddress(Address.parse("EQAlo09uk_Q8eyfmejNobKNL-2nnQqkbFUrsDfrLXGoC71lA")))
    // console.log(await fin.getFinancialData())
    const financial = provider.open(Financial.createFromConfig({
        unstakeRequestCode: await compile("UnstakeRequest"),
        transactionAdminAddress: "EQCEuIGH8I2bkAf8rLpuxkWmDJ_xZedEHDvjs6aCAN2FrkFp",
        commissionAddress: "EQCEuIGH8I2bkAf8rLpuxkWmDJ_xZedEHDvjs6aCAN2FrkFp",
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
        adminAddress: "EQCEuIGH8I2bkAf8rLpuxkWmDJ_xZedEHDvjs6aCAN2FrkFp",
        jettonWalletCode: await compile('JettonWallet')
    }, await compile('Financial'), 0));

    await financial.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(financial.address);
    // run methods on `financial`
}
