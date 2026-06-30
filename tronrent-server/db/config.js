require("dotenv").config();

module.exports = {
  development: {
    url: process.env.DATABASE_URL,
    dialect: "postgres",
    logging: false,
    define: {
      timestamps: true,
    },
  },
  test: {
    url: process.env.TEST_DATABASE_URL,
    dialect: "postgres",
    logging: false,
  },
  production: {
    url: process.env.DATABASE_URL,
    dialect: "postgres",
    logging: false,
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
  },
};
