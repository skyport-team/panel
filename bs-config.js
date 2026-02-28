module.exports = {
  proxy: "http://localhost:8001",
  files: ["views/**/*.ejs"],
  port: 8005,
  ui: {
    port: 8006,
  },
  open: false,
  notify: false,
};
