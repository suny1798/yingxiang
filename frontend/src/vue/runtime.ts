import { createPinia } from 'pinia';
import { createAppQueryClient,SessionScope } from './session-scope';
import { AccountCoordinator } from './account-coordinator';
import { createIdentitySignals } from './identity-signals';
export const pinia=createPinia();
export const queryClient=createAppQueryClient();
export const sessionScope=new SessionScope(queryClient,pinia);
export const accountCoordinator=new AccountCoordinator(sessionScope,undefined,createIdentitySignals());
