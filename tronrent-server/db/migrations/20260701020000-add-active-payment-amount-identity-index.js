"use strict";

const INDEX_NAME = "payments_active_amount_identity_unique";

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const [duplicates] = await queryInterface.sequelize.query(
        `
          SELECT
            "toAddress",
            "asset",
            "expectedAmountSun",
            COUNT(*)::int AS "count",
            array_agg("id"::text) AS "paymentIds"
          FROM "payments"
          WHERE "status" = 'awaiting_payment'
            AND "toAddress" IS NOT NULL
          GROUP BY "toAddress", "asset", "expectedAmountSun"
          HAVING COUNT(*) > 1
          LIMIT 10
        `,
        { transaction }
      );

      if (duplicates.length > 0) {
        throw new Error(
          `Cannot create ${INDEX_NAME}; duplicate active payment identities: ${JSON.stringify(
            duplicates
          )}`
        );
      }

      await queryInterface.sequelize.query(
        `
          CREATE UNIQUE INDEX "${INDEX_NAME}"
          ON "payments" ("toAddress", "asset", "expectedAmountSun")
          WHERE "status" = 'awaiting_payment'
            AND "toAddress" IS NOT NULL
        `,
        { transaction }
      );
    });
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `DROP INDEX IF EXISTS "${INDEX_NAME}"`,
        { transaction }
      );
    });
  },
};
