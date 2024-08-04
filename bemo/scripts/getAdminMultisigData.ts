import {NetworkProvider} from '@ton/blueprint'
import {AdminMultisig} from "../wrappers/AdminMultisig";
import {Address} from "@ton/core";

export async function run(provider: NetworkProvider) {
    const admin = provider.open(
        AdminMultisig.createFromAddress(Address.parse("EQDxQbuRc5lQjSE5LM5uB09zlZRUIvofHr7g-_vUNwj0kStM"))
    );
    console.log(await admin.getTempConfig());
}

