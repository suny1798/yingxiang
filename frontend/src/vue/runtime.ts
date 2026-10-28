import { createPinia } from 'pinia';
import { createAppQueryClient,SessionScope } from './session-scope';
import { AccountCoordinator } from './account-coordinator';
export const pinia=createPinia();
export const queryClient=createAppQueryClient();
export const sessionScope=new SessionScope(queryClient,pinia);
export const accountCoordinator=new AccountCoordinator(sessionScope);
