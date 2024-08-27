export interface KeyValueProviderInterface {
  name: string;
  description: string;
  userSetup(options?: any): Promise<boolean>;
  userAuthenticate(options?: any): Promise<boolean>;
  initialize(options?: any): Promise<boolean>;
  getValue(key: string | null): Promise<any>;
  setValue(key: string | null, value: any): Promise<boolean>;
  updateActiveScratchOrg(scratchOrg: any, keyValues: any);
}
