#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

const server = createServer({ portfolioPath: process.env.IDX_PORTFOLIO_PATH });
await server.connect(new StdioServerTransport());
// stdout dipakai protokol MCP — log hanya ke stderr
console.error("idx-stock-mcp berjalan (stdio)");
