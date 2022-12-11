/*
 * This file is part of WPPConnect.
 *
 * WPPConnect is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * WPPConnect is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with WPPConnect.  If not, see <https://www.gnu.org/licenses/>.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as puppeteer from 'puppeteer';
import * as qrcode from 'qrcode-terminal';
import { puppeteerConfig } from '../config/puppeteer.config';
import { isValidSessionToken } from '../token-store';
import { sleep } from '../utils/sleep';

export const getInterfaceStatus = async (
  waPage: puppeteer.Page
): Promise<puppeteer.HandleFor<Awaited<ReturnType<any>>>> => {
  return await waPage
    .waitForFunction(
      () => {
        const elLoginWrapper = document.querySelector(
          'body > div > div > .landing-wrapper'
        );
        const elQRCodeCanvas = document.querySelector('canvas');
        if (elLoginWrapper && elQRCodeCanvas) {
          return 'UNPAIRED';
        }

        const streamStatus = WPP?.whatsapp?.Stream?.displayInfo;
        if (['PAIRING', 'RESUMING', 'SYNCING'].includes(streamStatus)) {
          return 'PAIRING';
        }
        const elChat = document.querySelector('.app,.two') as HTMLDivElement;
        if (elChat && elChat.attributes && elChat.tabIndex) {
          return 'CONNECTED';
        }
        return false;
      },
      {
        timeout: 0,
        polling: 100,
      }
    )
    .then(async (element: puppeteer.HandleFor<Awaited<ReturnType<any>>>) => {
      return (await element.evaluate((a: any) => a)) as puppeteer.HandleFor<
        ReturnType<any>
      >;
    })
    .catch(() => null);
};

/**
 * Validates if client is authenticated
 * @returns true if is authenticated, false otherwise
 * @param waPage
 */
export const isAuthenticated = async (waPage: puppeteer.Page) => {
  return await waPage.evaluate(() => WAPI.isRegistered());
};

export const needsToScan = async (waPage: puppeteer.Page) => {
  const connected = await isAuthenticated(waPage);

  return !connected;
};

export const isInsideChat = async (waPage: puppeteer.Page) => {
  return await waPage.evaluate(() => WPP.conn.isMainReady());
};

export const isConnectingToPhone = async (waPage: puppeteer.Page) => {
  return await waPage.evaluate(
    () => WPP.conn.isMainLoaded() && !WPP.conn.isMainReady()
  );
};

export async function asciiQr(code: string): Promise<string> {
  return new Promise((resolve) => {
    qrcode.generate(code, { small: true }, (qrcode) => {
      resolve(qrcode);
    });
  });
}

export async function injectSessionToken(
  page: puppeteer.Page,
  token?: any,
  clear = true
) {
  if (!token || !isValidSessionToken(token)) {
    token = {};
  }

  await page.setRequestInterception(true);

  // @todo Move to another file
  const reqHandler = function (req: puppeteer.PageEventObject['request']) {
    if (req.url().endsWith('wppconnect-banner.jpeg')) {
      req.respond({
        body: fs.readFileSync(
          path.resolve(__dirname + '/../../img/wppconnect-banner.jpeg')
        ),
        contentType: 'image/jpeg',
      });
      return;
    }

    if (req.resourceType() !== 'document') {
      req.continue();
      return;
    }

    req.respond({
      status: 200,
      contentType: 'text/html',
      body: `
<!doctype html>
<html lang=en>
  <head>
    <title>Initializing WhatsApp</title>
    <style>
      body {
        height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: arial, sans-serif;
        background-color: #e6e6e6;
      }
      img {
        display: block;
        max-width: 100%;
        max-height:100%;
      }
      h1 {
        text-align: center;
      }
    </style>
  </head>
  <body>
    <div>
      <img src="wppconnect-banner.jpeg" />
      <h1>Initializing WhatsApp ...</h1>
    </div>
  </body>
</html>`,
    });
  };
  page.on('request', reqHandler);

  await page.goto(puppeteerConfig.whatsappUrl + '?_=' + Date.now());

  if (clear) {
    await page.evaluate(() => {
      if (document.title !== 'Initializing WhatsApp') {
        return;
      }

      localStorage.clear();

      window.indexedDB
        .databases()
        .then((dbs) => {
          dbs.forEach((db) => {
            window.indexedDB.deleteDatabase(db.name);
          });
        })
        .catch(() => null);
    });

    await sleep(2000);
  }

  if (token.WASecretBundle !== 'MultiDevice') {
    await page.evaluate((session) => {
      Object.keys(session).forEach((key) => {
        localStorage.setItem(key, session[key]);
      });
    }, token as any);
  }

  await page.evaluate(() => {
    localStorage.setItem('remember-me', 'true');
  });

  // Disable
  page.removeAllListeners('request');

  await page.setRequestInterception(false);
}
