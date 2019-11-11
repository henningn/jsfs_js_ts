import * as webpack from 'webpack';
import * as path from 'path'

let TerserPlugin = require('terser-webpack-plugin');
let BrotliPlugin = require('brotli-webpack-plugin');
let CompressionPlugin = require('compression-webpack-plugin');

let libraryTarget = process.env.TARGET_TYPE || "window";

const config: webpack.Configuration = {
    context: __dirname,
    entry: "./src/main/typescript/api/Jsf.ts",
    output: {
        path: path.resolve(__dirname, './dist/' + libraryTarget),
        libraryTarget: libraryTarget,
        filename: "jsf.js"
    },
    resolve: {
        extensions: [".tsx", ".ts", ".js", ".json"]
    },
    module: {
        rules: [
            // all files with a '.ts' or '.tsx' extension will be handled by 'ts-loader'
            {test: /\.tsx?$/, use: ["ts-loader"], exclude: /node_modules/}
        ]
    },
    optimization: {
        minimize: true,
        minimizer: [new TerserPlugin()],
    },
    plugins: [
        new webpack.SourceMapDevToolPlugin({
            filename: "[name].js.map"
        }),
        new CompressionPlugin({
            filename: '[path].gz[query]',
            algorithm: 'gzip',
            test: /\.js$|\.css$|\.html$|\.eot?.+$|\.ttf?.+$|\.woff?.+$|\.svg?.+$/,
            threshold: 10240,
            minRatio: 0.3

        }),
        new BrotliPlugin({
            asset: '[path].br[query]',
            test: /\.(js|css|html|svg)$/,
            threshold: 10240,
            minRatio: 0.3
        })

    ]
}

export default config;

