// A secrets provider gives sfdx-hardis the value of a secret by its name, for one target org.
// CI/CD variables are the only provider today; vaults (HashiCorp Vault, Azure Key Vault,
// AWS Secrets Manager...) will be new subclasses, chosen with `secretsProvider` in .sfdx-hardis.yml.

export interface SecretValueResult {
  // null when the secret is not found
  value: string | null;
  // Where the value was found (variable name, vault path), never the value itself
  source: string | null;
  // Every place looked up, in order
  lookedUp: string[];
}

export abstract class SecretsProviderRoot {
  /** Value of `secretsProvider` in .sfdx-hardis.yml */
  public abstract getKey(): string;

  public abstract getLabel(): string;

  /** The places a secret is read from for a target, in order. Never reads any value. */
  public abstract describeLookup(secretName: string, targetBranch: string | null): string[];

  /** Read a secret for a target. The caller registers the value for masking. */
  public abstract getSecret(secretName: string, targetBranch: string | null): Promise<SecretValueResult>;
}
