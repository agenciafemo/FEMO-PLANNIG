ALTER TABLE posts DROP CONSTRAINT posts_content_type_check;
ALTER TABLE posts ADD CONSTRAINT posts_content_type_check CHECK (content_type IN ('static', 'reels', 'carousel', 'story', 'blog'));