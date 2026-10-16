// SPDX-License-Identifier: GPL-3.0-or-later
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {ignores: ['src/_build/**']},
    ...tseslint.configs.recommended,
    {
        files: ['src/**/*.ts'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_',
            }],
        },
    }
);
