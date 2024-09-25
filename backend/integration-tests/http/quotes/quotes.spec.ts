import { medusaIntegrationTestRunner } from "medusa-test-utils";
import { adminHeaders, createAdminUser } from "../../utils/admin";
import {
  cartSeeder,
  productSeeder,
  regionSeeder,
  salesChannelSeeder,
} from "../../utils/seeder";
import {
  generatePublishableKey,
  generateStoreHeaders,
} from "../../utils/store";

jest.setTimeout(60 * 1000);

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let storeHeaders, cart, product, salesChannel, region;

    beforeEach(async () => {
      const container = getContainer();
      await createAdminUser(adminHeaders, container);
      const publishableKey = await generatePublishableKey(container);
      storeHeaders = generateStoreHeaders({ publishableKey });
      region = await regionSeeder({ api, adminHeaders, data: {} });

      salesChannel = await salesChannelSeeder({
        api,
        adminHeaders,
        data: {},
      });

      product = await productSeeder({
        api,
        adminHeaders,
        data: {
          sales_channels: [{ id: salesChannel.id }],
        },
      });

      await api.post(
        `/admin/api-keys/${publishableKey.id}/sales-channels`,
        { add: [salesChannel.id] },
        adminHeaders
      );

      cart = await cartSeeder({
        api,
        storeHeaders,
        data: {
          region_id: region.id,
          sales_channel_id: salesChannel.id,
          items: [{ quantity: 1, variant_id: product.variants[0].id }],
        },
      });
    });

    describe("POST /customers/quotes", () => {
      it("successfully initiates a quote with a draft order", async () => {
        const response = await api.post("/customers/quotes", {
          cart_id: cart.id,
        });

        const draftOrder = response.data.quote.draft_order;

        expect(response.status).toEqual(200);
        expect(response.data.quote).toEqual(
          expect.objectContaining({
            id: expect.any(String),
            cart_id: cart.id,
            draft_order_id: expect.any(String),
            draft_order: expect.objectContaining({
              status: "draft",
              is_draft_order: true,
              version: 1,
              items: [
                expect.objectContaining({
                  quantity: cart.items[0].quantity,
                  unit_price: cart.items[0].unit_price,
                }),
              ],
              summary: expect.objectContaining({
                paid_total: 0,
                difference_sum: 0,
                refunded_total: 0,
                transaction_total: 0,
                pending_difference: 100,
                current_order_total: 100,
                original_order_total: 100,
              }),
            }),
            order_change: expect.objectContaining({
              order_id: draftOrder.id,
              change_type: "edit",
              status: "requested",
              actions: [
                expect.objectContaining({
                  id: expect.any(String),
                  version: 2,
                  action: "ITEM_ADD",
                  details: expect.objectContaining({
                    metadata: {},
                    quantity: 1,
                    unit_price: 100,
                  }),
                }),
              ],
            }),
          })
        );
      });
    });

    describe("GET /customers/quotes/:id", () => {
      it("successfully retrieves a quote", async () => {
        const {
          data: { quote: newQuote },
        } = await api.post("/customers/quotes", { cart_id: cart.id });

        const {
          data: { quote },
        } = await api.get(`/customers/quotes/${newQuote.id}`);

        expect(quote).toEqual(
          expect.objectContaining({
            id: expect.any(String),
            cart: expect.objectContaining({
              id: cart.id,
            }),
            draft_order: expect.objectContaining({
              id: newQuote.draft_order_id,
            }),
          })
        );
      });

      it.only("should throw error when quote does not exist", async () => {
        const {
          response: { data },
        } = await api.get(`/customers/quotes/does-not-exist`).catch((e) => e);

        expect(data).toEqual({
          type: "not_found",
          message: "Order id not found: does-not-exist",
        });
      });
    });

    describe("GET /customers/quotes", () => {
      let cart2;

      beforeEach(async () => {
        cart2 = await cartSeeder({
          api,
          storeHeaders,
          data: {
            region_id: region.id,
            sales_channel_id: salesChannel.id,
            items: [{ quantity: 1, variant_id: product.variants[0].id }],
          },
        });
      });

      it("successfully retrieves all quote for a customer", async () => {
        const {
          data: { quote: quote1 },
        } = await api.post("/customers/quotes", { cart_id: cart.id });

        const {
          data: { quote: quote2 },
        } = await api.post("/customers/quotes", { cart_id: cart2.id });

        const {
          data: { quotes },
        } = await api.get(`/customers/quotes`);

        expect(quotes).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: quote1.id,
              cart: expect.objectContaining({
                id: cart.id,
              }),
              draft_order: expect.objectContaining({
                id: quote1.draft_order_id,
              }),
            }),
            expect.objectContaining({
              id: quote2.id,
              cart: expect.objectContaining({
                id: cart2.id,
              }),
              draft_order: expect.objectContaining({
                id: quote2.draft_order_id,
              }),
            }),
          ])
        );
      });
    });

    describe("POST /customers/quotes/:id/accept", () => {
      let quote1;

      beforeEach(async () => {
        const {
          data: { quote: newQuote },
        } = await api.post("/customers/quotes", { cart_id: cart.id });

        quote1 = newQuote;
      });

      it("successfully accepts a quote", async () => {
        const {
          data: { quote },
        } = await api.post(`/customers/quotes/${quote1.id}/accept`, {});

        expect(quote).toEqual(
          expect.objectContaining({
            id: quote1.id,
            draft_order: expect.objectContaining({
              id: quote1.draft_order_id,
              version: 2,
              status: "completed",
              summary: expect.objectContaining({
                pending_difference: 200,
              }),
              payment_collections: [
                expect.objectContaining({
                  amount: 200,
                }),
              ],
            }),
          })
        );
      });
    });

    describe("POST /customers/quotes/:id/reject", () => {
      let quote1;

      beforeEach(async () => {
        const {
          data: { quote: newQuote },
        } = await api.post("/customers/quotes", { cart_id: cart.id });

        quote1 = newQuote;
      });

      it("successfully rejects a quote", async () => {
        const {
          data: { quote },
        } = await api.post(`/customers/quotes/${quote1.id}/reject`, {});

        expect(quote).toEqual(
          expect.objectContaining({
            id: quote1.id,
            draft_order: expect.objectContaining({
              id: quote1.draft_order_id,
              version: 1,
              status: "canceled",
            }),
          })
        );
      });
    });
  },
});
