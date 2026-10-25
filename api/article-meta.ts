import renderPageHandler from './render-page.ts';

/**
 * Зворотна сумісність маршруту /api/article-meta?id=:id —
 * делегує рендеринг у централізований серверний HTML-рендерер /api/render-page.ts,
 * гарантуючи повноцінний вміст статті в #root, JSON-LD, 404 для чернеток/неіснуючих URL та 503 при збої БД.
 */
export default async function handler(req: any, res: any) {
  return renderPageHandler(req, res);
}
