#!/usr/bin/env node
/**
 * Amazon Book List Parser - TypeScript/Node.js Version
 * Extracts book information from Amazon list HTML and converts to JSON.
 */

import * as fs from 'fs';
import * as cheerio from 'cheerio';

interface BookData {
  asin?: string;
  data_attributes?: {
    csa_type?: string | null;
    csa_item_type?: string | null;
    csa_item_id?: string | null;
    csa_posx?: string | null;
    csa_posy?: string | null;
    csa_owner?: string | null;
    csa_id?: string | null;
  };
  product_link?: string;
  aria_label?: string;
  link_classes?: string[];
  image?: {
    src: string;
    alt: string;
    classes: string[];
    role: string;
  };
  author?: string;
  title?: string;
  pricing?: {
    current_price?: string;
    list_price?: string;
    availability_message?: string;
    price_attributes?: {
      size?: string | null;
      color?: string | null;
    };
  };
  delivery_info?: {
    data_attributes?: {
      item_id?: string | null;
      type?: string | null;
      item_type?: string | null;
      owner?: string | null;
      id?: string | null;
    };
    delivery_attributes?: {
      content_id?: string | null;
      delivery_price?: string | null;
      delivery_type?: string | null;
      delivery_time?: string | null;
      delivery_condition?: string | null;
      delivery_benefit_program_id?: string | null;
      mir_view?: string | null;
      mir_type?: string | null;
      mir_sub_type?: string | null;
    };
    delivery_text?: string;
  };
  quick_view?: {
    data_action?: string | null;
    modal_data?: string | null;
    button_text?: string;
    button_attributes?: {
      csa_type?: string | null;
      element_id?: string | null;
      element_type?: string | null;
      owner?: string | null;
      id?: string | null;
    };
  };
  item_classes?: string[];
}

interface OutputData {
  source: string;
  extraction_method: string;
  total_books: number;
  books: BookData[];
}

function parseAmazonHtml(htmlFile: string): BookData[] {
  const htmlContent = fs.readFileSync(htmlFile, 'utf-8');
  const $ = cheerio.load(htmlContent);

  // Find all book items
  const bookItems = $('div.single-list-item');
  const books: BookData[] = [];

  bookItems.each((_, item) => {
    const $item = $(item);
    const bookData: BookData = {};

    // Extract ASIN (Amazon Standard Identification Number)
    const asin = $item.attr('data-asin');
    if (asin) {
      bookData.asin = asin.replace('amzn1.asin.', '');
    }

    // Extract data attributes
    bookData.data_attributes = {
      csa_type: $item.attr('data-csa-c-type'),
      csa_item_type: $item.attr('data-csa-c-item-type'),
      csa_item_id: $item.attr('data-csa-c-item-id'),
      csa_posx: $item.attr('data-csa-c-posx'),
      csa_posy: $item.attr('data-csa-c-posy'),
      csa_owner: $item.attr('data-csa-c-owner'),
      csa_id: $item.attr('data-csa-c-id')
    };

    // Find main product link
    const $mainLink = $item.find('a.single-product-item-link');
    if ($mainLink.length > 0) {
      bookData.product_link = $mainLink.attr('href') || '';
      bookData.aria_label = $mainLink.attr('aria-label') || '';
      
      // Extract CSS classes from main link
      const classList = $mainLink.attr('class')?.split(' ').filter(cls => cls.length > 0) || [];
      bookData.link_classes = classList;
    }

    // Extract image information
    const $img = $item.find('img.product-image');
    if ($img.length > 0) {
      bookData.image = {
        src: $img.attr('src') || '',
        alt: $img.attr('alt') || '',
        classes: $img.attr('class')?.split(' ').filter(cls => cls.length > 0) || [],
        role: $img.attr('role') || ''
      };
    }

    // Extract product details
    const $brandElement = $item.find('span.product-brand-text');
    if ($brandElement.length > 0) {
      const $brandBdi = $brandElement.find('bdi');
      bookData.author = $brandBdi.length > 0 ? $brandBdi.text().trim() : $brandElement.text().trim();
    }

    const $titleElement = $item.find('span.product-title-text');
    if ($titleElement.length > 0) {
      const $titleBdi = $titleElement.find('bdi');
      bookData.title = $titleBdi.length > 0 ? $titleBdi.text().trim() : $titleElement.text().trim();
    }

    // Extract price information
    const $priceContainer = $item.find('div.product-price-container');
    if ($priceContainer.length > 0) {
      bookData.pricing = {};

      // Current price
      const $priceElement = $priceContainer.find('span.a-price');
      if ($priceElement.length > 0) {
        const $offscreenPrice = $priceElement.find('span.a-offscreen');
        if ($offscreenPrice.length > 0) {
          bookData.pricing.current_price = $offscreenPrice.text().trim();
        }

        // Price data attributes
        bookData.pricing.price_attributes = {
          size: $priceElement.attr('data-a-size'),
          color: $priceElement.attr('data-a-color')
        };
      }

      // List price (if available)
      const $basisPrice = $priceContainer.find('span.basis-price-text.a-text-strike');
      if ($basisPrice.length > 0) {
        bookData.pricing.list_price = $basisPrice.text().trim();
      }

      // Unavailable message
      const $unavailableText = $priceContainer.find('span.see-all-buying-option-text');
      if ($unavailableText.length > 0) {
        bookData.pricing.availability_message = $unavailableText.text().trim();
      }
    }

    // Extract delivery information
    const $primeBadge = $item.find('div.prime-badge-container');
    if ($primeBadge.length > 0) {
      const deliveryInfo: BookData['delivery_info'] = {
        data_attributes: {
          item_id: $primeBadge.attr('data-csa-c-item-id'),
          type: $primeBadge.attr('data-csa-c-type'),
          item_type: $primeBadge.attr('data-csa-c-item-type'),
          owner: $primeBadge.attr('data-csa-c-owner'),
          id: $primeBadge.attr('data-csa-c-id')
        }
      };

      // Extract delivery details from span
      const $deliverySpan = $primeBadge.find('span[data-csa-c-content-id]');
      if ($deliverySpan.length > 0) {
        deliveryInfo.delivery_attributes = {
          content_id: $deliverySpan.attr('data-csa-c-content-id'),
          delivery_price: $deliverySpan.attr('data-csa-c-delivery-price'),
          delivery_type: $deliverySpan.attr('data-csa-c-delivery-type'),
          delivery_time: $deliverySpan.attr('data-csa-c-delivery-time'),
          delivery_condition: $deliverySpan.attr('data-csa-c-delivery-condition'),
          delivery_benefit_program_id: $deliverySpan.attr('data-csa-c-delivery-benefit-program-id'),
          mir_view: $deliverySpan.attr('data-csa-c-mir-view'),
          mir_type: $deliverySpan.attr('data-csa-c-mir-type'),
          mir_sub_type: $deliverySpan.attr('data-csa-c-mir-sub-type')
        };

        deliveryInfo.delivery_text = $deliverySpan.text().trim();
      }

      bookData.delivery_info = deliveryInfo;
    }

    // Extract quick view button information
    const $quickViewContainer = $item.find('div.product-quick-view-btn-group');
    if ($quickViewContainer.length > 0) {
      const $quickViewSpan = $quickViewContainer.find('span.a-declarative');
      const $quickViewButton = $quickViewContainer.find('button.see-detail-circular-btn');

      if ($quickViewSpan.length > 0 && $quickViewButton.length > 0) {
        bookData.quick_view = {
          data_action: $quickViewSpan.attr('data-action'),
          modal_data: $quickViewSpan.attr('data-a-modal'),
          button_text: $quickViewButton.text().trim(),
          button_attributes: {
            csa_type: $quickViewButton.attr('data-csa-c-type'),
            element_id: $quickViewButton.attr('data-csa-c-element-id'),
            element_type: $quickViewButton.attr('data-csa-c-element-type'),
            owner: $quickViewButton.attr('data-csa-c-owner'),
            id: $quickViewButton.attr('data-csa-c-id')
          }
        };
      }
    }

    // Extract all CSS classes from the main item
    const itemClassList = $item.attr('class')?.split(' ').filter(cls => cls.length > 0) || [];
    bookData.item_classes = itemClassList;

    // Only add books that have essential information
    if (bookData.asin || bookData.title) {
      books.push(bookData);
    }
  });

  return books;
}

async function main(): Promise<number> {
  try {
    const books = parseAmazonHtml('amazon-list.html');

    // Create output structure
    const outputData: OutputData = {
      source: 'Amazon Founders Podcast Book List',
      extraction_method: 'TypeScript/Node.js + Cheerio',
      total_books: books.length,
      books: books
    };

    // Write to JSON file
    fs.writeFileSync('nodejs-list.json', JSON.stringify(outputData, null, 2), 'utf-8');

    console.log(`Successfully extracted ${books.length} books from Amazon list`);
    console.log('Output saved to: nodejs-list.json');

    return 0;
  } catch (error) {
    console.error(`Error parsing HTML: ${error}`);
    return 1;
  }
}

// Run the main function
main().then((exitCode) => {
  process.exit(exitCode);
}).catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});