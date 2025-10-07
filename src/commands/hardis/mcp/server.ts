import { Flags, SfCommand } from "@salesforce/sf-plugins-core";
import { AnyJson } from '@salesforce/ts-types';
import { McpServer, } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { z } from 'zod';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Config } from "@oclif/core";
import { execCommand } from '../../../common/utils/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default class SfdxHardisMcpServer extends SfCommand<any> {

  public static title = 'Sfdx-hardis MCP Server';

  public static description = ``

  public static examples = [
    '$ sf hardis:mcp:server --start',
  ];

  public static flags: any = {
    start: Flags.boolean({
      char: 's',
      default: false,
      description: 'Start the MCP server',
    }),
  }

  private server: McpServer;
  private commandIds: string[] = [];

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(SfdxHardisMcpServer);
    if (flags.start) {
      await this.createMcpServer();
      await this.loadSfdxHardisCommands();
      await this.startListener();
    }
    return { success: true };
  }

  private async createMcpServer() {
    this.log('Starting MCP server...');
    // Get version of current npm package
    const pkgPath = join(__dirname, '../../../../package.json');
    const version = JSON.parse(readFileSync(pkgPath, 'utf8')).version as string;
    this.server = new McpServer({
      name: 'sfdx-hardis-mcp-server',
      version: version,
      title: 'Sfdx-Hardis MCP Server to interact with Salesforce orgs and Metadatas',
      description: `This MCP server exposes sfdx-hardis commands as tools.
      Each command can be invoked with its flags as parameters.
      For example, the command 'hardis:org:diagnose:licenses' can be called with:
      {"hardis--org--diagnose--licenses": {"usedonly": true, "outputfile": "licenses.csv"}}`,
    });
    this.log('MCP server started successfully.');
  }

  /**
   * Loads all sfdx-hardis commands into the MCP server as tools.
   * 
   * This method:
   * 1. Loads the plugin configuration using Oclif Config
   * 2. Iterates through all commands starting with 'hardis:'
   * 3. Extracts command metadata (title, description)
   * 4. Builds Zod input schemas from command flags, handling:
   *    - Boolean, integer, string, and option types
   *    - Required vs optional flags
   *    - Default values
   *    - Flag descriptions
   * 5. Registers each command as an MCP tool with proper schema validation
   * 
   * The schema generation logic is inspired by the doc generation in hardis:doc:plugin:generate
   */
  private async loadSfdxHardisCommands() {
    this.log('Loading sfdx-hardis commands into MCP server...');
    const config = await Config.load({ root: __dirname, devPlugins: false, userPlugins: false });
    let commandCount = 0;

    for (const command of config.commands) {
      if (command.id.startsWith('hardis:')) {
        commandCount = await this.parseAndAddCommand(command, commandCount);
      }
    }

    this.log(`Successfully loaded ${commandCount} sfdx-hardis commands into MCP server.`);
  }

  private async parseAndAddCommand(command, commandCount: number) {
    const commandInstance = await command.load();
    const availableInMcp = (commandInstance as any).availableInMcp ?? false;
    if (!availableInMcp) {
      // this.log(`Skipping command not exposed to MCP: ${commandInstance.id}`);
      return commandCount;
    }
    const commandId = commandInstance.id;
    const commandIdFormatted = commandId.replace(/:/g, '_').replace(/-/g, '_');
    if (this.commandIds.includes(commandId)) {
      this.log(`Command already registered, skipping: ${commandId}`);
      return commandCount;
    }

    // Extract command metadata
    const title = commandInstance.title || commandInstance.description?.split('\n')[0] || commandId;
    let description = commandInstance.description || '';

    // Remove everything after <details markdown="1"> in description
    const detailsIndex = description.indexOf('<details markdown="1">');
    if (detailsIndex !== -1) {
      description = description.substring(0, detailsIndex).trim();
    }

    // Build input schema from command flags
    const inputSchemaProperties: Record<string, z.ZodTypeAny> = {};

    if (commandInstance.flags) {
      for (const [flagKey, flag] of Object.entries(commandInstance.flags)) {
        const flagDef = flag as any;

        // Skip common flags like debug, websocket, skipauth that are not relevant for MCP
        if (['debug', 'websocket', 'skipauth'].includes(flagKey)) {
          continue;
        }

        // Build Zod schema based on flag type
        let zodSchema: z.ZodTypeAny;
        switch (flagDef.type) {
          case 'boolean':
            zodSchema = z.boolean();
            break;
          case 'integer':
            zodSchema = z.number().int();
            break;
          case 'option':
            // Ensure options array is valid for z.enum()
            if (Array.isArray(flagDef.options) && flagDef.options.length > 0) {
              zodSchema = z.enum(flagDef.options as [string, ...string[]]);
            } else {
              // Fallback to string if options are invalid
              zodSchema = z.string();
            }
            break;
          default:
            zodSchema = z.string();
        }

        // Add description if available
        if (flagDef.description) {
          zodSchema = zodSchema.describe(flagDef.description);
        }

        // Handle optional vs required and default values
        if (!flagDef.required) {
          if (flagDef.default !== undefined) {
            zodSchema = zodSchema.default(flagDef.default);
          } else {
            zodSchema = zodSchema.optional();
          }
        }

        inputSchemaProperties[flagKey] = zodSchema;
      }
    }

    // Create input and output schemas - undefined if empty, otherwise the Zod shape object
    const inputSchema = Object.keys(inputSchemaProperties).length > 0
      ? inputSchemaProperties
      : undefined;

    const outputSchema = {
      success: z.boolean(),
      result: z.any().optional(),
      error: z.string().optional()
    };

    // Register the tool with MCP server
    this.server.registerTool(
      commandIdFormatted,
      {
        title: title,
        description: description,
        inputSchema: inputSchema as any,
        outputSchema: outputSchema as any
      },
      async (extra: any) => {
        try {
          // Extract command arguments from the extra parameter
          // MCP SDK passes arguments directly, not nested under params
          const commandArguments = extra.arguments || extra.params?.arguments || extra || {};

          // Log for debugging (will appear in MCP server logs, not client)
          process.stderr.write(`[MCP] Executing ${commandId}\n`);
          process.stderr.write(`[MCP] Extra structure: ${JSON.stringify(Object.keys(extra))}\n`);
          process.stderr.write(`[MCP] Arguments: ${JSON.stringify(commandArguments)}\n`);

          // Build the command string with flags
          let commandString = `sf ${commandId}`;

          // Add flags to the command string
          for (const [flagKey, flagValue] of Object.entries(commandArguments)) {
            if (flagValue === undefined || flagValue === null) {
              continue;
            }

            // Find the flag definition to get the short form if available
            const flagDef = commandInstance.flags?.[flagKey] as any;
            const flagName = flagDef?.char ? `-${flagDef.char}` : `--${flagKey}`;

            // Handle different flag types
            if (typeof flagValue === 'boolean') {
              if (flagValue === true) {
                commandString += ` ${flagName}`;
              }
            } else if (Array.isArray(flagValue)) {
              // For array values, add multiple instances of the flag
              for (const value of flagValue) {
                commandString += ` ${flagName} "${value}"`;
              }
            } else {
              commandString += ` ${flagName} "${flagValue}"`;
            }
          }

          // Execute the command
          const commandResult = await execCommand(commandString, null, {
            fail: false,
            output: true,
            debug: false
          });

          // Check if the command was successful
          const success = commandResult.status === 0;

          const output = {
            success: success,
            result: success ? commandResult.stdout : undefined,
            error: success ? undefined : commandResult.errorMessage || commandResult.stderr
          };

          return {
            content: [{ type: 'text' as const, text: JSON.stringify(output, null, 2) }],
            structuredContent: output,
            isError: !success
          };
        } catch (error) {
          const errorOutput = {
            success: false,
            error: error instanceof Error ? error.message : String(error)
          };

          return {
            content: [{ type: 'text' as const, text: JSON.stringify(errorOutput, null, 2) }],
            structuredContent: errorOutput,
            isError: true
          };
        }
      }
    );
    this.log(`Registered command as MCP tool: ${commandIdFormatted} - ${title}`);
    this.commandIds.push(commandId);
    commandCount++;
    return commandCount;
  }

  private async startListener() {
    const app = express();
    app.use(express.json());

    app.post('/mcp', async (req, res) => {
      // Create a new transport for each request to prevent request ID collisions
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
      });

      res.on('close', () => {
        transport.close();
      });

      await this.server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });

    const port = parseInt(process.env.PORT || '3000');
    app.listen(port, () => {
      console.log(`Sfdx-Hardis MCP Server running on http://localhost:${port}/mcp`);
    }).on('error', error => {
      console.error('Server error:', error);
      process.exit(1);
    });
  }

}