/**
 * PageGrab 插件 - 京东榜单商品列表采集
 *
 * 支持：
 *   - pro.m.jd.com/mall/active/.../index.html?rankId=...
 *
 * 数据来源：
 *   - 原始 HTML 内联脚本中的 window.__react_data__
 *
 * 采集字段：
 *   - rankId, pageNum, rankType, title, productCount, products
 */

function isJDRankListUrl(url) {
    try {
        const parsed = new URL(url);
        return (
            parsed.hostname === 'pro.m.jd.com' &&
            parsed.pathname.includes('/mall/active/') &&
            parsed.pathname.endsWith('/index.html') &&
            parsed.searchParams.has('rankId')
        );
    } catch {
        return false;
    }
}

function normalizeJdAssetUrl(value, pageUrl) {
    if (!value || typeof value !== 'string') return null;
    if (value.startsWith('//')) return `https:${value}`;
    if (/^https?:\/\//.test(value)) return value;
    if (value.startsWith('/')) {
        try {
            return new URL(value, pageUrl).toString();
        } catch {
            return value;
        }
    }
    return value;
}

function extractRankDataFromHtml(html) {
    if (!html || typeof html !== 'string') return null;

    const match = html.match(/window\.__react_data__\s*=\s*(\{[\s\S]*?\})\s*;/);
    if (!match) return null;

    let reactData;
    try {
        reactData = JSON.parse(match[1]);
    } catch {
        return null;
    }

    const floorList = reactData?.activityData?.floorList;
    if (!Array.isArray(floorList)) return null;

    const tmp1 = floorList.find((item) => item?.template === 'SsrCodeTemplate')?.providerData?.result ?? null;

    let productList;
    if (tmp1?.productList?.length) {
        productList = tmp1.productList;
    }
    if (tmp1?.mainRank?.products?.length) {
        productList = tmp1.mainRank.products;
    }

    let title;
    if (tmp1?.head?.rankPageTabListMap?.allSubTab?.length > 0) {
        let findTab = tmp1.head.rankPageTabListMap.allSubTab.find((item) => item?.tabName === '全部');
        if (!findTab && tmp1.head.rankPageTabListMap.allSubTab.length === 1) {
            findTab = tmp1.head.rankPageTabListMap.allSubTab[0];
        }
        if (findTab?.rankTypeTabs?.length > 0) {
            let findTab2 = findTab.rankTypeTabs.find((item) => item?.selected === '1');
            if (!findTab2 && findTab.rankTypeTabs.length === 1) {
                findTab2 = findTab.rankTypeTabs[0];
            }
            title = findTab2?.channelEntryTitle;
        }
    }
    if (!title) {
        title = tmp1?.mainRank?.title ?? null;
    }

    return {
        raw: reactData,
        productList,
        title,
    };
}

function normalizeRankProducts(products, pageUrl) {
    if (!Array.isArray(products)) return [];

    return products.map((product) => ({
        skuId: product?.skuId ?? product?.itemId ?? null,
        spuId: product?.spuId ?? null,
        title: product?.wareName ?? product?.skuName ?? product?.title ?? product?.name ?? null,
        price:
            product?.price ??
            product?.jdPrice ??
            product?.promotionPrice ??
            product?.finalPrice ??
            product?.priceInfo?.price ??
            null,
        rank: product?.rankNum ?? product?.rankNo ?? product?.ranking ?? product?.index ?? null,
        image: normalizeJdAssetUrl(product?.imageUrl ?? product?.imgUrl ?? product?.image ?? product?.picture, pageUrl),
        url: normalizeJdAssetUrl(product?.url ?? product?.jumpUrl ?? product?.itemUrl ?? product?.skuUrl, pageUrl),
        raw: product,
    }));
}

function getDocumentMatchUrl(url) {
    try {
        const parsed = new URL(url);
        return `${parsed.origin}${parsed.pathname}`;
    } catch {
        return url;
    }
}

const JDRankListPlugin = {
    name: 'jd-rank-list',
    match: isJDRankListUrl,

    async scrape(pg, url) {
        const tabId = await pg.openTab(url);

        try {
            const documentMatch = getDocumentMatchUrl(url);
            const documentResponse = await pg
                .waitForResponse(tabId, documentMatch, { timeout: 15000 })
                .catch(() => null);

            let html = documentResponse?.responseBody ?? null;
            if (!html) html = await pg.getHtml(tabId);

            const { raw, productList, title } = extractRankDataFromHtml(html);
            if (!productList?.length) {
                throw new Error('未能从榜单页 HTML 中提取 productList');
            }

            const parsedUrl = new URL(url);
            const products = normalizeRankProducts(productList, url);

            return {
                url,
                rankId: parsedUrl.searchParams.get('rankId'),
                pageNum: parsedUrl.searchParams.get('pageNum'),
                rankType: parsedUrl.searchParams.get('rankType'),
                title,
                productCount: products.length,
                products,
                _raw: raw,
            };
        } finally {
            pg.closeTab(tabId);
        }
    },
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        JDRankListPlugin,
        extractRankDataFromHtml,
        isJDRankListUrl,
        normalizeRankProducts,
    };
}
