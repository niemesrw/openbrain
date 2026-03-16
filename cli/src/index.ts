#!/usr/bin/env node
import { Command } from "commander";
import { signup } from "./commands/signup";
import { login } from "./commands/login";
import { createAgent } from "./commands/create-agent";
import { listAgents } from "./commands/list-agents";
import { revokeAgent } from "./commands/revoke-agent";
import { search } from "./commands/search";
import { capture } from "./commands/capture";
import { recent } from "./commands/recent";
import { stats } from "./commands/stats";
import { activity } from "./commands/activity";

const program = new Command();

program
  .name("brain")
  .description("Open Brain — your personal AI knowledge base")
  .version("1.0.0");

program
  .command("signup")
  .description("Create a new Open Brain account")
  .option("--api-url <url>", "API endpoint URL")
  .option("--client-id <id>", "Cognito CLI client ID")
  .option("--region <region>", "AWS region", "us-east-1")
  .action((options) => signup(options));

program
  .command("login")
  .description("Log in to your Open Brain account")
  .option("--email <email>", "Email address")
  .option("--password <password>", "Password")
  .option("--api-url <url>", "API endpoint URL")
  .option("--client-id <id>", "Cognito CLI client ID")
  .option("--region <region>", "AWS region")
  .action((options) => login(options));

program
  .command("create-agent <name>")
  .description("Create an API key for an AI agent")
  .action((name) => createAgent(name));

program
  .command("list-agents")
  .description("List your registered AI agents")
  .action(() => listAgents());

program
  .command("revoke-agent <name>")
  .description("Revoke an agent's API key")
  .action((name) => revokeAgent(name));

program
  .command("search <query>")
  .description("Search your brain by meaning")
  .option("--scope <scope>", "private, shared, or all")
  .option("--type <type>", "Filter by thought type")
  .option("--topic <topic>", "Filter by topic")
  .option("--limit <n>", "Max results")
  .action((query, options) => search(query, options));

program
  .command("capture <text>")
  .description("Save a new thought to your brain")
  .option("--scope <scope>", "private or shared")
  .action((text, options) => capture(text, options));

program
  .command("recent")
  .description("Browse recent thoughts")
  .option("--scope <scope>", "private, shared, or all")
  .option("--type <type>", "Filter by thought type")
  .option("--topic <topic>", "Filter by topic")
  .option("--limit <n>", "Number of results")
  .action((options) => recent(options));

program
  .command("stats")
  .description("Get an overview of your brain")
  .action(() => stats());

program
  .command("activity")
  .description("Monitor the public feed")
  .option("--hours <n>", "Look back this many hours", "24")
  .option("--limit <n>", "Max thoughts to return", "50")
  .option("--agent <name>", "Filter to a specific agent")
  .action((options) => activity(options));

program.parse();
