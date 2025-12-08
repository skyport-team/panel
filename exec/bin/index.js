#!/usr/bin/env node

const { Command } = require("commander");

const program = new Command();

program
  .version("0.1.0-beta6")
  .description("Command Line Interface for the Skyport Panel");

program
  .command("seed")
  .description("Seeds the images to the database")
  .action(() => {
    require("../seed.js");
  });

program
  .command("createUser")
  .description("Creates a new Admin user")
  .action(() => {
    require("../createUser.js");
  });

program.parse(process.argv);
