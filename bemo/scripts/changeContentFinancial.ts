import {Address, toNano} from '@ton/core'
import {NetworkProvider} from '@ton/blueprint'
import {AdminMultisig} from "../wrappers/AdminMultisig";
import {
    getAdminMultisigInternalPayload,
    getChangeContentPayload
} from "../wrappers/utils/AdminMultisigUtils";

export async function run(provider: NetworkProvider) {
    const admin = provider.open(AdminMultisig.createFromAddress(Address.parse("EQDxQbuRc5lQjSE5LM5uB09zlZRUIvofHr7g-_vUNwj0kStM")));

    const payload = getChangeContentPayload({
        description: "new",
        name: "new",
        symbol: "new"
    });

    const msg = getAdminMultisigInternalPayload(payload, 0, 28800);

    await admin.sendInternal(provider.sender(), toNano("0.03"), msg);
}
