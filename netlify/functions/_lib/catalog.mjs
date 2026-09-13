/**
 * Catalogue — built fresh from the database, in the exact shape the shared
 * pricing module (js/lib/pricing.js) and the browser both consume.
 *
 * This is what makes the server authoritative: prices and stock come from
 * Supabase at the moment of the request, never from the browser and never
 * from a static file.
 */

import { db } from './supabase.mjs';

export async function loadCatalogFromDb() {
  var results = await Promise.all([
    db('GET', 'shop_config?select=*&limit=1'),
    db('GET', 'products?active=is.true&select=id,sku,slug,number,category,name,colour,description,price_paise,compare_at_price_paise,image,alt&order=number.asc'),
    db('GET', 'product_variants?active=is.true&select=id,product_id,size,sku,price_paise,stock_qty')
  ]);

  var config = (results[0] && results[0][0]) || {};
  var products = results[1] || [];
  var variants = results[2] || [];

  var SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

  var byProduct = new Map();

  variants.forEach(function (variant) {
    var list = byProduct.get(variant.product_id) || [];
    list.push(variant);
    byProduct.set(variant.product_id, list);
  });

  return {
    currency: 'INR',
    freeShippingThresholdPaise: config.free_shipping_threshold_paise ?? 299900,
    shippingFlatPaise: config.shipping_flat_paise ?? 9900,
    codEnabled: config.cod_enabled !== false,
    products: products.map(function (product) {
      var sizes = (byProduct.get(product.id) || [])
        .sort(function (a, b) {
          return SIZE_ORDER.indexOf(a.size) - SIZE_ORDER.indexOf(b.size);
        })
        .map(function (variant) {
          return {
            size: variant.size,
            variantId: variant.id,
            pricePaise: variant.price_paise || null,
            stock: variant.stock_qty
          };
        });

      return {
        productId: product.id,
        sku: product.sku,
        slug: product.slug,
        number: product.number,
        category: product.category,
        name: product.name,
        colour: product.colour,
        description: product.description,
        pricePaise: product.price_paise,
        compareAtPricePaise: product.compare_at_price_paise || null,
        image: product.image,
        alt: product.alt,
        sizes: sizes
      };
    })
  };
}
